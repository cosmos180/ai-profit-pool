# A3 · EV/EBITDA 数据契约 + D&A 采购单

> 状态：设计稿（ADR，只定契约与采购单；不改生产代码/数据）
> 缺口来源：分析师 A 级最后一项——
> 「半导体重资产折旧巨大，EBITDA 比 Sales 可比得多；缺它，我对代工/存储的相对估值判断是瘸腿的。」
> 本波只交付两件：(1) `d_and_a` 原始事实契约 + EV/EBITDA 派生/caveat 语义；(2) 库内 14 家逐家 D&A 采购单。
> 数据采集（🧑 Dayu/PDF）与 selector/UI 落地是后续两批，本 ADR 只画边界。

---

## 0. 一句话架构判断

**D&A 是现金流量表口径的原始事实，只挂 `periods[].d_and_a`（可空，**本批 annual-only**；季度须先立「累计 YTD → 单季原子」契约后另批做，见 §4 红线 8），不进 `year` schema，走 gross_profit 同款「只进 periods、years 不加」先例。EBITDA 与 EV/EBITDA 一律算不存——`ebitda = op_income + d_and_a` 由 selector 现算，EV/EBITDA 挂 comps 表第 5 个数值列，caveat 复用现有四态机器。**

关键约束（决定采购单边界）：**EBITDA 需要 `op_income` 与 `d_and_a` 两个输入都非空**。库内实跑发现 softbank / tencent 的 annual `op_income` 全为 null——所以补 D&A 也点不亮它俩，采购单对这两家分别「省略 / 缓」。而分析师真正要的代工/存储/设计一线（TSMC、Samsung、SK、Micron、NVIDIA、Broadcom、ASML、Arm、Oracle）op_income 与 net_debt 均已齐，**只差 D&A 一个字段即可全部点亮**——采集回报率极高。

---

## 1. 背景：现状实跑普查（2026-07-14 库内 14 家）

- 库内 `meta.unit = USD bn`；14 家全 `status=populated`；共 **41 个 annual actual periods**。
- **`d_and_a` 字段当前 100% 不存在**（41 期全无）——纯增量，加字段零破坏。
- `op_income`（EBITDA 的另一半）覆盖：**12 家齐、2 家全 null**：
  - `softbank`：3 期 op_income 全 null（IFRS 未录营业利润；且投资控股，EBITDA 无经营含义）。
  - `tencent`：3 期 op_income 全 null（IFRS 营业利润含「其他收益净额」公允价值变动，口径失真）。
- `net_debt`（EV 的另一半，EV=market_cap+net_debt）覆盖：**11 家有、3 家 null**（google / microsoft / amazon）。
- 结论：EV/EBITDA 的四态覆盖由 **d_and_a × op_income × net_debt** 三者共同门控。补齐 D&A 后的预期覆盖见 §6。

---

## 2. 决策一：`d_and_a` 挂哪、什么契约

### D1 挂载层 — period 级可空字段，years 不加（gross_profit 同款先例）

在 `schema.json` 的 `definitions.period.properties` 新增：

```jsonc
"d_and_a": {
  "type": ["number", "null"],
  "description": "Period depreciation & amortization (折旧摊销) from the CASH-FLOW STATEMENT add-back line, in meta.unit (USD bn), sign-neutral non-negative magnitude. Source caliber redline: the CF-statement 'Depreciation and amortization' line — OR the arithmetic sum of its explicitly-disclosed CF sub-lines (D&A of PP&E + amortization of intangibles), with the label naming both. NEVER a non-GAAP adjusted-EBITDA add-back, NEVER an earnings-call figure. Absent/undisclosed ⇒ null (comps cell shows 待补). data_status: official ONLY for a USD single-line direct take; summing disclosed sub-lines or converting non-USD via fx_to_usd stores a computed value ⇒ data_status=derived (arithmetic is never upgraded to official), label keeping the original line values, the formula, and the fx used. Quarter atoms MUST be true single-quarter magnitudes — 10-Q/IFRS interim cash-flow statements report cumulative YTD figures, and writing a 6M/9M cumulative into a quarter period is a data error; quarterly collection is deferred until the YTD→single-quarter derivation contract lands (same-FY same-basis adjacent cumulative diff, Q1 direct, result derived with both cumulative sources in the label; unmet ⇒ do not collect). EBITDA is DERIVED, never stored: Selectors.ebitda = op_income + d_and_a (算不存). IFRS filers (TSMC/ASML/Samsung/SK/Tencent) include IFRS-16 right-of-use asset depreciation here — kept as-reported, NOT stripped (stripping = forbidden non-GAAP adjustment); the cross-GAAP wrinkle is disclosed in the derived-layer caveat note, not adjusted away."
}
```

**双写规则不适用**：`year` schema **不加** `d_and_a`。理由与 gross_profit 完全一致——EV/EBITDA 的 comps 分母走 `latestActualAnnual`（periods 侧最新实际年，见 data-module.js:423），year 侧无消费者。加进 year 只会多一处双写对账负担，无收益。这也让本次改动对 legacy `years[]` 零触碰、天然向后兼容。

### D2 EBITDA / EV/EBITDA 算不存

- `ebitda(period)` = `op_income + d_and_a`，两者任一 null → null。**不存**任何 EBITDA 字段。
- `evEbitda(c)` = `ev(c) / ebitda(latestActualAnnual(c))`，caveat 门控（见 D3）。EV 复用现有 `ev = market_cap + net_debt`，与 EV/Sales 同一 EV，跨指标口径一致。
- 全 null-safe，绝不伪造 0/ 估算。周期底部年（如 micron/skhynix FY2023 op_income 为负）EBITDA 可能趋零或为负 → 该年 EV/EBITDA 无意义，但 comps 用**最新实际年**（均已恢复盈利），不受影响。

### D3 valuationCaveat 新增 `ev_ebitda` 键

`valuation_caveat` schema 的 `additionalProperties:false` 需放开一格——新增枚举字段：

```jsonc
"ev_ebitda": {"enum": ["ok", "distorted", "na"]}
```

逐家 caveat 建议见 §3。selector 侧 `evEbitda` 复用现有 `valuationCaveat(c,"ev_ebitda")==="na" → null` 的门控范式（与 evSales 逐字对称）。

---

## 3. 决策二：逐家 EV/EBITDA caveat 建议表

| 公司 | 环节 | ev_ebitda | 理由 | D&A 采集 |
|---|---|---|---|---|
| nvda | 设计 | **ok** | US-GAAP，op_income 实、D&A 干净 | 采 |
| broadcom | 设计 | **ok** | 并购密集、无形摊销巨大 → EBITDA 加回正是其可比价值所在（feature 非 bug） | 采 |
| arm | 设计 | **ok** | US-GAAP（20-F 报 US-GAAP），轻资产但 D&A 存在 | 采 |
| tsmc | 代工 | **ok** | IFRS，重资产折旧巨大——**分析师头号诉求命中点**；EBITDA 剥离折旧后代工/存储**可比性显著改善，但非精确同期/同口径可比**（IFRS-16 租赁折旧、并购摊销、混业结构差异仍在，见 §4 红线 4；caveat note 保留披露） | 采 |
| micron | 存储 | **ok** | US-GAAP。周期底部年 EBITDA 可趋零，comps 用最新实际年（FY2025 已盈利）→ ok | 采 |
| skhynix | 存储 | **ok** | IFRS。同 micron，最新实际年（FY2025）盈利 → ok | 采 |
| samsung | 存储 | **ok** | IFRS。含非存储业务但合并 EBITDA 口径成立 | 采 |
| asml | 设备 | **ok** | IFRS，重资产设备商，EBITDA 口径干净 | 采 |
| oracle | 云 | **ok** | US-GAAP，数据中心资本开支/折旧大，EBITDA 有意义 | 采 |
| google | 云 | **ok**（但暂 blank） | caveat ok，但 net_debt 未录 → EV 无法算 → EV/EBITDA **待补**（待 net_debt，非 caveat 问题） | **留空**（FY2025 现金流量表仅折旧行，无法取纯 D&A，见红线 3b） |
| microsoft | 云 | **ok**（但暂 blank） | 同 google：net_debt 缺 → 待补 | **留空**（"and other" 并列加项不可隔离，见红线 3b） |
| amazon | 云 | **ok**（但暂 blank） | 同 google：net_debt 缺 → 待补 | 采 |
| tencent | 应用 | **distorted** | IFRS 营业利润含公允价值变动 → EBITDA 失真；且 op_income 当前全 null，**双重阻塞**（补 D&A 也点不亮，需先补 op_income，属另一采集批次） | **缓**（B 级，依赖 op_income） |
| softbank | 投资 | **na** | 投资控股，op_income 全 null 且无经营含义，EBITDA 语义不成立 | **省略**（不采） |

**关键区分**：google/ms/amazon 的 caveat 是 `ok`——它们的 EV/EBITDA 空是 `blank`（缺 net_debt 待补），不是 `na`。softbank 才是 `na`（结构上不适用）。tencent 是 `distorted`（口径失真，出值但降级），但当前因 op_income 缺而暂显 `blank`（补齐 op_income+d_and_a 后转 distorted 出值）。这三种「空」在 comps 表用不同微标（待补 / 不适用 / ⚠）区分，守诚实命门。

---

## 4. 决策三：口径红线（采集端硬约束）

| # | 红线 | 说明 |
|---|---|---|
| 1 | **只取现金流量表 D&A 行** | 「Depreciation and amortization」经营活动加回行。**不用**损益表分散的折旧、**不用** MD&A/分部附注里的口径 |
| 2 | **分列求和须 label 写明** | 若无单一 D&A 行，但现金流量表分列「Depreciation of PP&E」+「Amortization of intangibles」→ 求和，label 写明两行原文值与求和式。**求和结果 data_status=`derived`**——库内惯例：任何算术（求和/相减/换汇）的存储值都是 derived，「同一张表求和」不构成升格 official 的理由 |
| 3 | **禁 non-GAAP adjusted EBITDA** | 不从公司自报的 adjusted EBITDA 反推 D&A；不从电话会/IR PPT 取。只认 filing 现金流量表 |
| 3b | **"and other" 两种语法**（2026-07-16 采购实例） | 行名含 "and other" 须区分语法：**资产类别修饰**（amazon「D&A of PP&E and capitalized content costs, operating lease assets, and other」——整行 XBRL concept 即 D&A，other 是被折旧/摊销的资产）→ 可取；**并列加项**（microsoft「Depreciation, amortization, and other」——other 是与 D&A 并列的第三类调整）→ 不可隔离，**留空**。同理 google FY2025 只呈列折旧无摊销行 → 折旧≠D&A，留空 |
| 4 | **IFRS-16 租赁折旧不剥离** | IFRS 报表（TSMC/ASML/Samsung/SK）的 D&A 含使用权资产折旧，US-GAAP 同业不含——**照现状存**，剥离即违禁的 non-GAAP 调整。跨 GAAP 差异在派生层 caveat note 披露，不在数据层调 |
| 5 | **符号与量级** | 存**非负量级**（现金流量表加回本就为正），与 capex 同约定；方向由派生层处理 |
| 6 | **非美元按各期库内 fx** | 源币 raw D&A ÷ 该期 `fx_to_usd`（4 位）得 USD bn；label 注明源币值与所用 fx，须与该期库内 fx 一致 |
| 7 | **data_status** | **USD 单行直取 → `official`**；分列求和或非美元经 fx 换算 → **`derived`**（换汇、相减、求和后的存储值一律 derived，算术结果不因底层行来自官方 filing 而升格），label 保留原始行、公式与 fx；缺就 null（**留空比填错好**），comps 该格「待补」 |
| 8 | **quarter 本批不采（累计 YTD 陷阱）** | 多数 10-Q / IFRS 中期现金流量表披露的是**累计值**（6M/9M），而 `periods[] kind=quarter` 是单季原子——把累计数写进 Q2/Q3 = 数据错误。季度 D&A 须先另批立契约：**同财年、同口径相邻累计值作差**得单季（Q1 直取首季累计），结果标 `derived` 且 label 写明两个累计源值与作差式；条件不满足（缺相邻累计、口径重述）则不采 |

---

## 5. 决策四：消费面契约增量

### 5.1 Selectors 新增（data-module.js，后续批次落地，本 ADR 只定签名）

```js
// 纯派生，算不存；null-safe；复用 ev / latestActualAnnual / valuationCaveat
ebitda(y)     { return (y && y.op_income != null && y.d_and_a != null)
                       ? y.op_income + y.d_and_a : null; }
evEbitda(c)   {
  if (this.valuationCaveat(c, "ev_ebitda") === "na") return null;
  const e = this.ev(c), eb = this.ebitda(this.latestActualAnnual(c));
  return (e != null && eb != null && eb > 0) ? e / eb : null;    // EBITDA≤0 → null(负倍数无意义,诚实留空)
}
```

落地批合成测试须**分别**覆盖 EBITDA<0（周期底部年，负倍数禁出值）与 EBITDA=0 两个用例，断言均返回 null。

### 5.2 comps 表加 EV/EBITDA 列（列驱动，零组件算术）

comps 表已是**列驱动**（`COMPS_COLS` 数组 + 统一四态判定循环，见 data-module.js:596-701）。加列 = 往数组塞一条 + 补三本文案词典，**无新增分支逻辑**：

```js
// COMPS_COLS 追加（已拍板：EV/Sales 后、FCF yield 前，默认可见）：
{ key:"evEbitda", sel:"evEbitda", caveat:"ev_ebitda", rel:"evEbitda",
  label:"EV/EBITDA", kind:"mult", accent:false },

// VAL_KEY_META 追加（供 stageValuationRel 同环节相对位）：
evEbitda: { caveat:"ev_ebitda", lowerCheaper:true },

// _valMetric / stageValuationRel 的 key 分派加一支 evEbitda → this.evEbitda(c)

// 三本文案词典各加一条：
COMPS_NA_REASON.ev_ebitda      = "投资控股，无经营 EBITDA 含义 → 诚实留空。";
COMPS_DISTORT_REASON.ev_ebitda = "营业利润含公允价值变动 → EBITDA 失真，出值但仅供参考。";
COMPS_BLANK_NOTE.evEbitda      = "待补现金流量表 D&A（或缺 net_debt / 营业利润）→ 补齐后自动点亮。";
```

**四态、排序键、覆盖度全部沿用现有机器**，无增量契约：
- `state ∈ {ok, distorted, na, blank}`：与其他列同一判定循环（na→null；distorted 值非空出值否则 blank；值非空 ok；否则 blank）。
- `sortKey = (ok||distorted) ? value : null`，`—` 恒沉底。
- `column.covered` 自动统计（state∈{ok,distorted} 行数）。
- `lowerCheaper:true`（低=便宜），同 pe/ps/evSales 方向。
- 默认排序仍锚 forwardPE 升序不变；EV/EBITDA 作为可点排序列之一。

UX 侧已拍板：EV/EBITDA **默认可见**，列序 `EV/Sales` 后、`FCF yield` 前；PS 继续作为可选列；移动端沿用现有横向滚动 + sticky 公司列；落地批实测 1280/390。

### 5.3 validate.py 校验增量

| 规则 | 层级 | 级别 | 说明 |
|---|---|---|---|
| `d_and_a >= 0` | period | **ERROR** | 复用 capex 同款非负量级守卫（validate.py:279-281 模板）；存负值 = 采集错误 |
| **不**加入双写字段列表 | — | — | double-write 列表（validate.py:527 `revenue/net_income/op_income/cfo/capex`）**不含** d_and_a——periods-only，与 gross_profit 同策，year 侧无对账 |
| `d_and_a` 缺失 | period | **不报** | annual actual 缺 d_and_a **不 ERROR**（与 gross_profit 的硬门控不同）——EV/EBITDA 是加性列，blank 是诚实态，非阻塞。守「缺就 null」 |
| `d_and_a > revenue`（可选软护栏） | period | WARN | D&A 超营收极不寻常，提示采集端复核（非强制） |
| EBITDA 可派生 INFO（可选） | period | INFO | op_income 与 d_and_a 均非空时打 INFO「EBITDA 可派生 = op_income + d_and_a」，与 FCF 可派生 INFO（validate.py:358）对称 |

**向后兼容验证点**：schema 加可空 period 字段 + valuation_caveat 加枚举字段，均 additive；validate 只加 `d_and_a>=0` 守卫，而库内当前 41 期 d_and_a 全无 → 无一触发。**改后须先跑 `validate.py` 确认旧数据 0 破**，再开采集。

---

## 6. 采购单：逐家 D&A 清单（🧑 Dayu/PDF 通道）

规则：现金流量表真实披露值；USD bn（非美元按该期库内 `fx_to_usd` 换算并注明，data_status=derived）；走 merge.py **仅含 periods 的部分对象**增量并入，**不改 `years[]`**（year schema 无 d_and_a）。**本批 annual-only**——quarter 一律不采（累计 YTD 陷阱，见 §4 红线 8）。

### 口径分级

| 级 | 判定 | data_status |
|---|---|---|
| A | 现金流量表**单行 Depreciation and amortization**，USD 直取 | official |
| A-fx | 单行但非美元 → ÷ 该期库内 `fx_to_usd` | **derived**（换汇即算术，不升格），label 注源币原值与所用 fx |
| B | 无单行，但现金流量表**分列** D&A of PP&E + amortization of intangibles → 求和 | **derived**，label 写明各行原文值与求和式（非美元再叠 fx 说明） |
| 缓 | op_income 当前为 null，补 D&A 也点不亮（需先补 op_income，属另一批次） | tencent |
| 省略 | op_income 全 null 且 EBITDA 语义不成立 | softbank（不采） |

### 逐家清单

| 公司 | 级 | 来源表 | annual 缺口（**最新一期必采**，余期独立回补） | quarter（**本批不采**，仅列另批候选） |
|---|---|---|---|---|
| nvda | A | 10-K 现金流量表 | fy2024/25/26-annual (3) | fy2026q1 |
| samsung | A/B | 사업보고서 현금흐름표（KRW，按各期 fx） | fy2024/25-annual (2) | 2026q1 |
| broadcom | A | 10-K（无形摊销大，注意 D&A 是否单行含摊销） | fy2023/24/25-annual (3) | fy2025q1/q2, fy2026q1 |
| micron | A | 10-K 现金流量表 | fy2023/24/25-annual (3) | fy2025q1..fy2026q2 (5) |
| skhynix | A/B | 사업보고서 현금흐름표（KRW，按各期 fx） | fy2023/24/25-annual (3) | 2025q1..2026q1 (4) |
| tsmc | A | 20-F / 6-K 现金流量表（TWD，按各期 fx）——**分析师核心标的** | fy2023/24/25-annual (3) | — |
| asml | A | 20-F / 6-K Consolidated Statement of Cash Flows（EUR，按各期 fx） | fy2023/24/25-annual (3) | — |
| google | A | 10-K 现金流量表 | fy2023/24/25-annual (3) | 2023q3..2025q3 (7) |
| microsoft | A | 10-K 现金流量表 | fy2023/24/25-annual (3) | fy2024q2..fy2026q2 (7) |
| amazon | A | 10-K 现金流量表（D&A of PP&E and capitalized software） | fy2023/24/25-annual (3) | — |
| oracle | A | 10-K Consolidated Statements of Cash Flows | fy2024/25/26-annual (3) | fy2024q2..fy2026q2 (7) |
| arm | A | 20-F 现金流量表（US-GAAP） | fy2024/25/26-annual (3) | — |
| **tencent** | **缓** | HKEX 年报现金流量表（RMB）——需与 op_income 同批采，否则 EV/EBITDA 仍 blank | (fy2023/24/25, 3，依赖 op_income) | — |
| **softbank** | **省略** | —（投资控股，EBITDA 无经营含义，ev_ebitda=na） | 不采 | 不采 |

### 采购单摘要（原计划拍板「12 期最小集」；**2026-07-16 最终采购结果：12 家已审、10 期入库、2 期契约留空**）

- **采购结果（Issue #32 Phase A，逐 filing 审核）**：12 家最新实际年全部完成审核，**10 条入库**（official 4：nvda/micron/amazon/arm；derived 6：samsung/broadcom/skhynix/tsmc/asml/oracle），**2 条契约性留空**——
  - **google FY2025**：现金流量表只呈列 `Depreciation of property and equipment 21,136M`，无摊销行、`Other 2,108M` 不可拆——填折旧会让字段失真，从附注补违反红线 1 → **留空**；
  - **microsoft FY2025**：`Depreciation, amortization, and other 34,153M` 的 "and other" 是**并列加项**不可隔离 → **留空**。
  - 两家 net_debt 本就缺失（EV 不可算），留空对覆盖零影响；数据锚点（test-snapshot.js）锁死这两条不得误填。
- **本批入库：10 期**（12 家最新实际年全部审核后的可入库集，分母走 `latestActualAnnual`），端到端点亮 EV/EBITDA 列（9 家出值）；**google/microsoft 2 期为契约性留空，不是待采**——重新填入须先推翻 Issue #32 的采购裁定。
- **独立回补：剩余 23 个历史 annual periods**（全量视野 35 期 = nvda3 + samsung2 + broadcom3 + micron3 + skhynix3 + tsmc3 + asml3 + google3 + microsoft3 + amazon3 + oracle3 + arm3；其中 google/microsoft 的历史期须逐份复核同款现金流行口径问题，大概率同样留空），不阻塞当前 A3，补齐后额外解锁未来「EBITDA 利润率趋势」年度视图（重资产折旧的历史轨迹，半导体尤有价值）。
- **缓：tencent 3 期**（须与 op_income 同批，否则点不亮；已拍板延后至专项采集批）。
- **省略：softbank 3 期**（na）。
- 合计视野覆盖库内全部 41 个 annual actual periods（**12 审核（10 入库 + 2 契约留空）** + 23 回补 + 3 缓 + 3 省略）。

### 补齐后预期 EV/EBITDA 覆盖（本波即可达）

| 态 | 家数 | 公司 |
|---|---|---|
| **ok 出值** | **9** | nvda, broadcom, arm, tsmc, micron, skhynix, samsung, asml, oracle |
| blank（缺 net_debt 待补） | 3 | google, microsoft, amazon |
| blank/distorted（缺 op_income，缓） | 1 | tencent |
| na（不适用） | 1 | softbank |

→ EV/EBITDA 将成为仅次于 trailing PE 的**第二高覆盖估值列（9/14）**，且 9 家全部覆盖分析师点名的设计/代工/存储/设备一线——采集回报率最高的一列。

### 自检（产物 _selfcheck）

- A 级（USD 单行直取）：存储值与 filing 现金流量表呈列值逐字一致，data_status=official；
- A-fx 级：源币 raw D&A 与 filing 呈列值逐字一致；存储 USD = raw ÷ fx_to_usd（4 位），fx 与库内该期一致；data_status=**derived**，label 注源币原值与 fx；
- B 级：两条 D&A 分列原文值 + 求和式写进 label，data_status=**derived**；不得混入损益表折旧或分部口径；
- 交叉校验（采集端自检，validate 不强制）：`d_and_a` 与同期 `capex` 量级合理（重资产年 D&A 常与 capex 同数量级）；`op_income + d_and_a` 得出的隐含 EBITDA margin 落在行业常识区间；
- IFRS 家（tsmc/asml/samsung/skhynix）注明 D&A 含 IFRS-16 使用权折旧，**不剥离**。

---

## 7. 影响面（受影响的层/文件）

| 层 | 文件 | 改动 | 批次 |
|---|---|---|---|
| 契约 | `schema.json` | period 加 `d_and_a`（可空）；valuation_caveat 加 `ev_ebitda` 枚举 | 本 ADR 附带（可先落 schema） |
| 校验 | `validate.py` | 加 `d_and_a>=0` ERROR；（可选）D&A>revenue WARN、EBITDA 可派生 INFO；**不**入双写列表 | 随 schema |
| 数据 | `companies.json` | 12 家最新实际年完成审核，**10 期入库 + 2 期契约留空（非待采）**（merge.py periods 增量），years 不动；23 期历史独立回补 | 采集批（🧑 Dayu/PDF） |
| 派生 | `data-module.js` | 加 `ebitda`/`evEbitda`；COMPS_COLS 加列 + 三本文案词典 + VAL_KEY_META + _valMetric 分派 | selector 批 |
| 呈现 | `web/` Comps.svelte | 列驱动零算术，随 compsTable 自动多一列；列位/移动端归位 | UI 批 |

---

## 8. 拍板结果（2026-07-16 用户复核落定，PR #27）

1. **采集深度**：原计划「12 期最小集先落地」；**最终采购裁定（Issue #32）：12 家最新实际年完成审核，10 期入库 + 2 期契约留空（google/microsoft 现金流行口径不可隔离，非待采）**，端到端点亮 EV/EBITDA 列；剩余 23 个历史 annual periods **独立回补**，不阻塞当前 A3。
2. **tencent op_income：延后**——非本批核心环节，且即使出值仍为 distorted；交给专项采集批。
3. **quarter D&A：本批不采**——禁止机会主义写入累计值；等「累计 YTD → 单季」契约与测试（§4 红线 8）另批再做。
4. **EV/EBITDA 列：默认可见**，列序 `EV/Sales` 后、`FCF yield` 前；PS 继续作为可选列；移动端沿用现有横向滚动 + sticky 公司列，落地批实测 1280/390。

---

## 9. 范围栅栏

本 ADR **只定契约与采购单**。数据采集（🧑 Dayu/PDF，**12 家最新实际年完成审核：10 期入库 + 2 期契约留空（非待采）**，23 期历史独立回补）与 selector/UI 落地（`ebitda`/`evEbitda` + comps 加列 + Comps.svelte）是后续两批，各自独立可验收。schema 若先落，须即跑 `validate.py` 确认库内旧数据 0 破再开采集。
