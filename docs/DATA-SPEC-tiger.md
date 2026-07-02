# DATA-SPEC-tiger — 老虎证券(Tiger Open API)取数规格

> 面向对象:一个能调用 Tiger `QuoteClient` 的取数 skill。
> 目标:skill 按本规格输出 JSON → 经 `tools/merge.py` 合并 → `validate.py` 0 ERROR → `cd web && bun run build` 上屏。
> skill **只吐原始事实**,不算派生比率,不碰视图,不改代码。
>
> 单位一律 **USD bn**。项目"今天" = 2026-06-30(见 validate.py `TODAY`)。
> 本文是契约,不是实现。schema 增量(第 7 节)是**提案**,落地由架构师/工程师后续执行;
> 在提案落地前,skill 不得输出提案中的新字段(会被 `additionalProperties:false` 或 enum 卡掉)。

---

## 0. 先读这一节:★口径决策(最关键)

**现状:`companies.json` 是刻意构造的「2026 AI 超级周期」情景数据,不是真实实际值。**
证据:NVDA 里 `FY2027E` 营收 390 / 净利 225 USD bn、`quote.market_cap` 4660(US$4.66T),
这些是前瞻/情景数字;真实 trailing 值对不上。整套 13 家公司都在同一情景口径下人工贴合过
(consensus 文本、quote、quarters 都是手工核验的一致快照)。

**Tiger 给的是真实实际值。两者混用会产生口径撕裂:**同一张利润池迁移图里若一半公司是
情景值、一半是 Tiger 真实值,迁移趋势、AI 加权池、龙头占比全部失真——而这三者正是本项目的核心视图
(`profitPoolAI` / `profitPoolMigration` / `profitPoolTTM`,见 data-module.js)。

### 架构师推荐:路径 (b) —— 一次性全量迁真实,别 piecemeal

| | (a) 保留 2026 情景 | **(b) 全量迁真实(推荐)** |
|---|---|---|
| Tiger 的角色 | **只做校准/补录辅助**:quote 快照、季度 net_income 自滚、前瞻 EPS;actual 年**不从 API 直拉覆盖**(会打破情景) | Tiger 成为 actual 年 + quote + quarters 的**主数据源**,一次性把 13 家全重拉成真实口径 |
| 一致性 | 需人工持续维护情景自洽,脆弱 | API 一次拉齐,口径天然一致 |
| 采集成本 | 低,但每次都要人判断"这条能不能进" | 一次性中等,之后可复跑 |
| 失真风险 | 混用即失真;必须严守"只补不覆盖 actual" | 低——只要**整批一起换**,不留混合态 |
| provenance | 情景值多为 consensus/estimate | Tiger actual 标 `derived`,可信度更高 |

**理由:** 本项目的价值主张是"数据/视图解耦 + 可信派生"。情景数据是 demo 骨架,不是可持续的真相源;
Tiger 付费权限让"真实口径"第一次变得可采集。**决策一旦选 (b),就必须整批迁移**——
`profitPoolMigration` 按"距最新实际年的位置"跨公司对齐(pos 0/1/2…),
若只迁一部分公司,同一 position 上会混着情景年和真实年,迁移柱直接失真。

> 若产品经理坚持保留 2026 情景做展示(路径 a):则本规格的 actual 年映射(第 1 节 years[])**不适用**,
> skill 只输出第 2 节 quote、第 3 节 quarters、第 6 节前瞻 EPS 三块,且 actual 年一律不碰。
> 二选一,写死在采集任务里,不要每公司临时决定。

**下面第 1–6 节按路径 (b) 写(Tiger 作主数据源)。**

---

## 1. 字段映射表 — companies.json 每字段 ← Tiger

单位换算总则:Tiger 财报数值一般是**原币绝对值(元/美元)**。
`bn(x) = round(x / 1e9, 4)`。非美元公司见第 5 节先换 USD 再 `/1e9`。缺字段一律 `null`,**绝不填 0**。

### 1.1 公司顶层(company)

| companies.json 字段 | 来源 | 换算 / 约定 | 谁填 |
|---|---|---|---|
| `id` | **人工约定,见第 4/5 节** | 必须匹配现有 id(见下方硬清单),否则 merge 产生重复 | skill 按映射表填 |
| `name` | `get_stock_fundamental` 英文名 | **中文名人工补**(如 "NVIDIA 英伟达");skill 只填英文名占位 | 英文 skill / 中文人工 |
| `ticker` | 交易所 + symbol | 自由文本,如 `"NASDAQ · NVDA"` / `"TWSE 2330 · NYSE TSM"` | skill |
| `region` | `get_stock_fundamental` 国家/地区 | 自由文本(中文更佳,人工可改) | skill(英)/人工(中) |
| `sector` | `get_stock_fundamental` 行业 | 自由文本 | skill |
| `currency` | `get_financial_currency` | **财报本币** ISO 4217(如 USD/TWD/KRW/CNY/EUR)。这是"报表口径"不是价格口径 | skill |
| `seg_profit` | **人工判断项** | enum yes/partial/no;Tiger 给不了分部 → skill **不要输出**(merge 保留旧值;新公司缺则由人补) | 人工 |
| `status` | 固定 `"populated"` | 有 years 数据即 populated | skill |
| `quote` | 见 1.2 | | skill |
| `years[]` | 见 1.3 | | skill |
| `quarters[]` | 见 1.4 | | skill |
| `chain_stage` / `ai_exposure` / `ai_profit_share` / `ai_revenue_share` / `ai_share_source` / `valuation_caveat` / `logo_text` / `logo_class` / `lead` / `fy_note` | **人工判断项** | skill **一律不输出**(见第 4 节);merge 的 JUDGEMENT_KEYS 会保留旧值 | 人工 |

> **id 硬清单(务必写死,错一个就重复):**
> `nvda`(不是 nvidia)、`broadcom`(**不是 avgo**)、`tsmc`(不是 tsm)、`samsung`、`skhynix`、
> `micron`(不是 mu)、`asml`、`softbank`、`tencent`、`google`(**不是 googl**)、
> `microsoft`(**不是 msft**)、`amazon`(**不是 amzn**)、`oracle`(不是 orcl)。
> 新公司才用 `ticker.lower()` 作 id;已有公司必须用上面的 id。

> **注意 `id` 与 `chain_stage` 的隐藏耦合:** data-module.js 有 `STAGE_OF_FALLBACK` 按 **id** 兜底环节
> (nvda→design、tsmc→foundry…)。所以已有 13 家即使 skill 不输出 `chain_stage`,靠 id 兜底仍进迁移图;
> **新公司必须人工补 `chain_stage`**,否则不进利润池/迁移图(honest 降级,merge 会提示)。

### 1.2 quote(市场快照 — 单切片原始事实,倍数派生不存)

`additionalProperties:false` —— **只允许下列键,多一个字段就 schema 报错**。

| quote 字段 | 来源 | 换算 / 约定 | data_status |
|---|---|---|---|
| `as_of` | 取数当日 或 `get_financial_daily` 数据日期 | ISO `YYYY-MM-DD`。>今天 → WARN;早于今天 90 天 → WARN(见 validate.py) | — |
| `market_cap` | `get_financial_daily` → `Valuation.market_capitalization` | **换成 USD bn**(非美元公司先按 as_of 汇率换 USD 再 /1e9)。必须 > 0 | 见 sources |
| `net_debt` | `get_financial_report`(资产负债表) | **口径 = 有息债务(排经营租赁) − (现金及等价物 + 短期投资)**,换 USD bn。负数 = 净现金。缺任一分量 → `null`(不猜)。**不要用某些源现成的 netDebt 字段**(常只减现金不减短投,误报净负债) | 见 sources |
| `price` | `get_financial_daily` 收盘价 | **本币价,原样,不换汇**(仅展示/对账)。可 `null` | — |
| `price_currency` | 价格所在市场货币 | ISO 4217(如 USD/HKD/KRW/TWD)。**可能≠ `currency`**(财报本币):如 tencent 财报 CNY、price HKD | — |
| `sources[]` | 见下 | 每条 `{label,url,data_status}`,url 必须 http(s) 绝对链接 | 见下 |

`sources` 建议至少两条:market_cap 一条、net_debt 一条(注明资产负债表口径 + 汇率)。
market_cap/price 来自 Tiger 行情 → `derived`(聚合源);若人工核对交易所/公司披露可升 `official`。

> **EV 合理性闸门:** validate.py 会拒绝 `market_cap + net_debt < 0`(EV<0 口径异常)。
> net_debt 是净现金(负值)时,`|net_debt|` 不应超过 market_cap 量级——若超了,基本是符号/单位错了。

### 1.3 years[](财年 — 实际年 actual)

来自 `get_financial_report(symbols, period_type=年度)` 的利润表 + 现金流表。**升序排列(旧→新)**,validate.py 强制。

| year 字段 | Tiger 来源(period_type=年度) | 换算 / 符号约定 | data_status |
|---|---|---|---|
| `fy` | 报表财年 | 格式 `FY2025`(实际)/ `FY2025E`(预测)。**必须匹配 validate 正则** `^FY\d{4}E?$` | — |
| `period_end` | 报表期末日 | 自由文本人读用,如 `"截至 2025-01-25"`。**仅展示,不做日期运算** | — |
| `period_end_iso` | 报表期末日 | ISO `YYYY-MM-DD`。**机读键**,迁移图年对齐优先用它 | — |
| `status` | 固定 `"actual"` | 实际年 | — |
| `revenue` | 利润表 total revenue | USD bn,`bn()`。**必填(actual)**。< 0 报错 | derived |
| `gross_margin` | 利润表 gross profit ÷ revenue | **唯一允许的派生比率**(披露口径原样)。∈[0,1],否则报错。缺 → `null` | derived |
| `op_income` | 利润表 operating income | USD bn。缺 → `null` | derived |
| `net_income` | 利润表 net income(归母,GAAP) | USD bn。**必填(actual)**。`net_income > revenue` 报错 | derived |
| `capex` | 现金流表 capital expenditures | **取绝对值 `bn(abs(x))`**(现金流里通常为负;本库存非负量级,方向由派生层处理)。< 0 报错。缺 → `null` | derived |
| `cfo` | 现金流表 net cash from operating activities | USD bn。缺 → `null` | derived |
| `sources[]` | Tiger 报表链接/标识 | 每条 `{label,url,data_status}`。**actual 年必填**,url 必须 http(s) 绝对链接 | derived |
| `segments[]` | **人工判断项**(Tiger 给不了分部) | skill **不要输出**;merge 按 period_end_iso 保留旧年的手工 segments | 人工 |
| `consensus_rev` / `consensus_eps` | 见第 6 节说明 | **现有是自由文本 string**;actual 年不填,别破坏 | — |
| `anchors[]` | 可选 | 展示锚点,可留空 | — |

**符号 / 口径约定汇总(硬约束):**
- `capex` 存**非负量级**(绝对值);`fcf = cfo − capex` 在派生层算,skill 不算。
- `net_income` 取**归母 GAAP 净利**(与现有 quarters 口径一致,如 NVDA GAAP)。不要用 non-GAAP/adjusted。
- `capex` 与 `cfo` **建议成对录入**(只录一个 → WARN,FCF 无法派生)。
- 所有数值 `data_status: "derived"`(Tiger 是聚合源,非一手 filing;人工对照 10-K/20-F 后可升 `official`)。

### 1.4 quarters[](季度原子 — 供 TTM 自滚,见第 3 节)

`additionalProperties:false`。来自 `get_financial_report(period_type=季度)`,升序。

| quarter 字段 | Tiger 来源 | 换算 / 约定 |
|---|---|---|
| `period_end` | 季末日 | ISO `YYYY-MM-DD`,**机读**。TTM 自滚只认它,不认 label |
| `label` | — | 人读标签,如 `"Q1 FY2027"` / `"CQ1 2026"`。仅展示 |
| `net_income` | 季度归母 GAAP 净利 | USD bn,`bn()`。缺 → `null`(会使该 TTM 派生为 null,诚实缺) |
| `revenue` | 季度营收 | USD bn,可选(启用 TTM 营收/PS-TTM) |
| `sources[]` | Tiger 季报链接 | 每条 `{label,url,data_status}`,`derived` |

**需要几个季度?** TTM 自滚需要:最新完整 FY 之后的每个新季 **+ 各自 12 个月前的对位季**。
稳妥取 **最近 8 个季度**,覆盖"3 个 post-FY 新季 + 3 个对位季"这类最长情形(如 Micron)。

---

## 2. quote 已在 1.2。此处补:非美元公司的换算(见第 5 节)。

---

## 3. TTM 口径选择 —— 结论:输出 quarters[],复用现有自滚(零代码改动)

**背景:** Tiger 直接给 LTM(=TTM)聚合值;现有 data-module.js 的 `ttmNetIncome(c)` 从 `quarters[]`
自滚(TTM = 最新完整 FY 净利 + FY 期末后各新季 − 各自 12 个月前对位季)。二选一。

**决策:skill 输出 `quarters[]`(原子季度),不输出 Tiger 的 LTM 聚合值。**

**理由:**
1. **零代码改动 + 不变量对齐。** 现有 `profitPoolTTM` / `ttmNetIncome` 已按 quarters 自滚,且 TTM
   是"算不存"的派生值(不变量 1)。若引入直接 TTM 字段,得改 schema + data-module + 所有 TTM 派生,
   还等于**把派生值存进原始层**,违背核心不变量。
2. **可追溯。** quarters[] 是带 period_end + source 的原子事实,视图能下钻、能对账;LTM 聚合值是
   不透明黑盒,provenance 只能整体标一个来源。
3. **口径统一。** 现有自滚对 FY 非自然年(NVDA 财年 1 月末)、多 post-FY 季(Micron)已处理妥当;
   混入 Tiger LTM 会和自滚口径漂移。

**代价 & 接受:** 自滚要求"新季 + 对位季"齐全,任一季 `net_income` 缺 → TTM 派生 `null`(诚实缺,
不 impute)。这正是期望行为。**skill 只要把最近 8 季如实吐出即可,TTM 交给 app 现算。**

> 若未来要"更准的一手 LTM",那是独立提案(需改 data-module),不在本规格;当前锁定 quarters 自滚。

---

## 4. 判断项人工清单 —— skill 不要输出(或输出占位由人补)

以下字段 Tiger **给不了**,是人的判断,skill **一律不输出**(merge 的 `JUDGEMENT_KEYS` +
`merge_year_segments` 会在覆盖时保留旧值,不会被一次取数冲掉):

| 字段 | 位置 | 为什么人工 |
|---|---|---|
| `segments[]` + 每个 `is_ai` | year 内 | 分部拆分 + 平台/division 对账 + AI 归因,Tiger 无分部数据。**驱动 AI 加权池代理** |
| `seg_profit`(yes/partial/no) | company | 披露能力自适应的三态分流,靠人读披露判断 |
| `chain_stage` | company | 价值链环节归位(设计/代工/存储/…);已有 13 家有 id 兜底,**新公司必补** |
| `ai_exposure` | company | AI 归因兜底桶(pure/primary/partial/peripheral) |
| `ai_profit_share` / `ai_revenue_share` + `ai_share_source` | company | 顶层 AI 归因估计,必带 provenance(estimate/derived) |
| `valuation_caveat` | company | 失真标记(如软银投资控股扭曲 PE/净利率);判断题 |
| 中文 `name` / `logo_text` / `logo_class` / `lead` / `fy_note` | company | 展示文案,人工润色 |
| `consensus_rev`(自由文本) | forecast year | 见第 6 节 |

**skill 输出的对象里,以上字段应完全不出现**(不是设 null)。原因:
`chain_stage`/`ai_exposure`/`seg_profit` 在 schema 里是 enum/string **无 null 类型**,输出 null 会被 schema 卡;
不输出则走 merge 覆盖保护保留旧值,或对新公司留待人补。

---

## 5. 单位与货币(USD bn 统一)

- **报表本币** = `get_financial_currency`。非 USD 时,财报数值先用 `get_financial_exchange_rate`
  换成 USD,再 `/1e9`。**source 里必须注明汇率、汇率日期、口径**(如
  `"TWD→USD @ 0.0308(2025-01-25 收盘,Tiger get_financial_exchange_rate)"`)。
- **market_cap** 换 USD bn(按 as_of 当日汇率)。现有非美元公司都已是 USD-bn market_cap
  (tsmc 2360 / samsung 1340 / tencent 481),保持一致。
- **price** 保留**本币原值**,配 `price_currency`;**绝不跨币种相乘**。注意 price_currency 可能
  ≠ 财报 currency(如 tencent 财报 CNY、price HKD;asml 财报 EUR、price 挂 USD ADR)。
- 换算口径二选一并注明:actual 年数值建议用**期间平均汇率**(损益类),资产负债 net_debt 用**期末汇率**;
  实在拿不到就用单一 as_of 汇率并注明。留空也比填错好——汇率拿不到就把该公司标出、暂缓,不硬换。

---

## 6. 前瞻字段(需 schema 增量) —— 支持前瞻 PE

**背景:** `get_corporate_earnings_calendar` 提供**预期 EPS(forward/consensus)**、实际 EPS、发布日。
现有 schema 里 forecast 年的 `consensus_eps` / `consensus_rev` 是**自由文本 string**(如 `"$9.34"`),
不可参与数值派生。要支持前瞻 PE,需要一个**数值型** consensus EPS。

### 6.1 schema 增量提案(最小、加性、可选、向后兼容)

> **这是提案,未落地前 skill 不得输出下列新字段。** 落地由架构师改 schema.json + validate.py。

在 `definitions.year.properties` 新增(仅用于 `status:"forecast"` 年):

```jsonc
"consensus_eps_value":    { "type": ["number","null"],
  "description": "数值型一致预期 EPS(每股),本币,前瞻 PE 派生用。与现有自由文本 consensus_eps 并存不冲突;仅 forecast 年有意义。null=未取到。" },
"consensus_eps_currency": { "type": "string",
  "description": "consensus_eps_value 的币种 ISO 4217(通常=price_currency)。前瞻 PE 用 price 口径时需同币。" },
"consensus_eps_source":   { "type": "array", "items": { "$ref": "#/definitions/source" },
  "description": "consensus_eps_value 的 provenance;data_status 必为 'consensus'。非空时强制(validate.py 追加规则)。" }
```

- **为什么新键而非复用 `consensus_eps`:** 现有 `consensus_eps` 是 string 且已有数据在用,改类型会破坏旧数据 +
  破坏 schema 校验。新增 `consensus_eps_value`(number)与之并存,**旧数据零改动即通过**。
- **前瞻营收:** Tiger 不一定给一致预期营收 → **不提案 consensus_rev_value,诚实留空**,继续用自由文本 `consensus_rev`。
- **validate.py 配套(落地时):** 当 `consensus_eps_value` 非 null → 必须有 `consensus_eps_source` 且每条
  `data_status == "consensus"`(否则 ERROR);EPS 币种建议校验 = price_currency。
- **data-module.js 配套(落地时,交工程师):** 新增 `forwardPE(c)` 派生 —
  口径 = **price ÷ consensus_eps_value**(两者同为 price_currency,跨币安全);
  或 market_cap 口径需 consensus 净利(Tiger 一般只给 EPS)→ 优先 price 口径。
  UI **必须与 trailing PE 严格区分**标注(这条给工程师/设计师,契约层只保证:前瞻值单独字段 + data_status=consensus,不与 trailing 混池)。

### 6.2 skill 侧(提案落地后)

forecast 年填:`consensus_eps_value`(数值,`get_corporate_earnings_calendar` 预期 EPS)、
`consensus_eps_currency`(= price_currency)、`consensus_eps_source`(**data_status 必为 `consensus`**)。
预期营收拿不到就不填。**提案落地前,skill 只用现有自由文本 `consensus_eps` 字段,或不输出前瞻年。**

---

## 7. 输出 JSON 形状 + 流程

### 7.1 形状

- **单公司** → 一个对象;**多公司** → 对象数组(与 fetch_fmp.py 一致,merge.py 两者都吃)。
- 顶层**只输出 company 对象本身**,不要包 `{meta,companies}`(meta 由 companies.json 持有,skill 不碰 meta.stages)。
- 每个对象**必须有 `id`**(merge 按 id 合并;缺 id 直接报错)。

### 7.2 单公司输出样例(路径 b,真实口径,USD bn)

```jsonc
{
  "id": "nvda",                         // ← 硬清单 id,不是 nvidia
  "name": "NVIDIA",                     // 英文占位;中文名人工补
  "ticker": "NASDAQ · NVDA",
  "region": "US",
  "sector": "Semiconductors",
  "currency": "USD",                    // 财报本币(get_financial_currency)
  "status": "populated",
  // seg_profit / chain_stage / ai_* / valuation_caveat / logo_* / lead / fy_note:
  //   一律不输出 → merge 保留旧值,新公司留待人补
  "quote": {
    "as_of": "2026-06-30",
    "market_cap": 4200.0,               // USD bn(非美元先换汇)
    "net_debt": -54.09,                 // 有息债务−(现金+短投),USD bn,负=净现金;缺分量→null
    "price": 175.0,                     // 本币原值,不换汇
    "price_currency": "USD",
    "sources": [
      { "label": "Tiger get_financial_daily market_capitalization (NVDA @2026-06-30)",
        "url": "https://.../tiger/quote/NVDA", "data_status": "derived" },
      { "label": "net_debt: Tiger 资产负债表 有息债务(排经营租赁)−现金及短投",
        "url": "https://.../tiger/financials/NVDA/balance", "data_status": "derived" }
    ]
  },
  "years": [
    {
      "fy": "FY2025", "period_end": "截至 2025-01-26", "period_end_iso": "2025-01-26",
      "status": "actual",
      "revenue": 130.5, "gross_margin": 0.75, "op_income": 81.45,
      "net_income": 72.88, "capex": 3.24, "cfo": 64.09,   // capex 取绝对值
      "sources": [
        { "label": "Tiger get_financial_report income (NVDA, FY2025, 年度)",
          "url": "https://.../tiger/financials/NVDA/income", "data_status": "derived" },
        { "label": "Tiger get_financial_report cash-flow (NVDA, FY2025, 年度)",
          "url": "https://.../tiger/financials/NVDA/cashflow", "data_status": "derived" }
      ]
    }
    // …其余实际年,升序
  ],
  "quarters": [
    {
      "period_end": "2026-04-26", "label": "Q1 FY2027",
      "net_income": 58.3, "revenue": 44.06,
      "sources": [
        { "label": "Tiger get_financial_report income (NVDA, CQ 季度)",
          "url": "https://.../tiger/financials/NVDA/income?period=quarter", "data_status": "derived" }
      ]
    }
    // …最近约 8 季,升序;供 TTM 自滚
  ]
}
```

非美元公司差异:`currency` = 本币;years/quote 数值已换 USD bn 且 source 注明汇率;
`price` 本币原值 + `price_currency` 本币。

### 7.3 流程(一条龙)

```bash
# 1) skill 产出对象/数组 → 落文件(或走管道)
#    (skill 自身输出;下面用 merge.py 收尾)

# 2) 合并 + 校验 + 构建(覆盖保护会保留人工判断项)
python3 tools/merge.py /path/to/tiger-out.json           # 文件
#   或   <skill 输出> | python3 tools/merge.py -           # 管道
python3 tools/merge.py /path/to/tiger-out.json --dry-run # 先看会改动谁
python3 tools/merge.py /path/to/tiger-out.json --no-build # 只合并+校验,暂不重建

# merge.py 内部会:按 id 合并 → 跑 validate.py → 0 ERROR 才写盘 → cd web && bun run build;
# 任一步失败自动回滚 companies.json。
```

- **覆盖保护:** 同 id 覆盖时,新对象缺的 `chain_stage`/`seg_profit`/`ai_*`/`valuation_caveat`/中文
  `name`/`logo_*` 等,自动用旧值补;segments 按 `period_end_iso` 对齐保留。所以重拉真实财务
  **不会冲掉人工判断项**——这正是路径 (b) 能安全整批迁移的前提。
- **手工合并(不用 merge.py):** 追加进 `companies.json` 的 `companies[]` →
  `python3 validate.py companies.json schema.json`(0 ERROR)→ `cd web && bun run build`。

---

## 8. skill 自检清单(输出前逐条过)

1. `id` 命中硬清单(nvda/broadcom/tsmc/…/google/microsoft/amazon),不是 ticker 别名。
2. 所有数值 USD bn(`/1e9`);非美元已换汇且 source 注明汇率+日期+口径。
3. `capex` 取**绝对值**(非负);`net_income ≤ revenue`;`gross_margin ∈[0,1]`。
4. actual 年有 `revenue`+`net_income`+`sources`;`fy` 匹配 `FY\d{4}E?`;years 升序。
5. quote:`market_cap>0`;`as_of` ISO 且不晚于今天;`net_debt` 缺分量则 null;`market_cap+net_debt≥0`;有 sources。
6. 每条 source 有 `url`(http/https 绝对链接)+ `data_status`;Tiger 数据标 `derived`,前瞻 EPS 标 `consensus`。
7. **未输出**任何判断项(segments/seg_profit/chain_stage/ai_*/valuation_caveat/中文文案)。
8. **未输出**未落地的提案字段(consensus_eps_value 等),除非 schema 增量已合入。
9. 缺字段一律 `null`,**没有编造、没有填 0**。
10. quarters 最近约 8 季,`period_end` 机读 ISO,net_income 本币已换 USD bn。

---

## 附:相关文件(绝对路径)

- 数据契约:`/home/user/ai-profit-pool/schema.json`
- 入库校验:`/home/user/ai-profit-pool/validate.py`
- 派生口径(Selectors/TTM 自滚/aiShare/pe-ps-evSales-fcfYield/quote):`/home/user/ai-profit-pool/data-module.js`
- 已有采集器(产物形状参照):`/home/user/ai-profit-pool/tools/fetch_fmp.py`
- 合并/覆盖保护/回滚:`/home/user/ai-profit-pool/tools/merge.py`
- 真相源:`/home/user/ai-profit-pool/companies.json`
- 采集说明:`/home/user/ai-profit-pool/tools/README.md`
