# 广口径迁移 · 第二批「年度视图 / 桑基链」ADR

> 状态：**D1+D4 已落地**（2026-07-08，工程师）。D1（ValuationCard 展示锚迁 latestActualAnnual，零可见变化，closes #13）+ D4（validate.py 双写一致性扩到 op_income/cfo/capex + 逐分部，硬 ERROR）已实现并全绿；**D2/D3 数值行整迁门控在 annual period 的 `gross_profit` 补录**（见三），本批不做。Home L230 period_end 自由文本锚（决策点 b）本批不迁。
> 上游：`docs/plans/broad-migration-b1-valuation.md`（已落地先例）、`docs/plans/period-base-refactor.md`（双写规则 D5 / consumer ledger）、`docs/ROADMAP.md`。
> 迁移顺序（用户已拍板）：估值链（B1 ✅）→ **年度视图/桑基（本批 B2）** → AI 池（B3）→ 前瞻（B4）。
> 复用 B1 方法论：消费方普查 → 契约 → 平价硬门禁 → 回退策略 → honesty/测试/栅栏/决策点。

---

## 一句话架构判断

**B2 与 B1 不是同一种迁移。** B1 是把 4 个标量分母做一次「换源即零行为变化」的内部替换；B2 面对的是一整块**富呈现面**（KPI 卡 / 年度表 / 桑基 / 段落表），而 periods 侧目前**并非 years[] 的完整替身**——`gross`（毛利）在 annual period 上 **14/14 家全为 null**、`forecast` 年在 periods 上 **0 家存在**。平价实测证明：headline + 分部共 **945 个展示单元 0 不一致**（revenue/op_income/net_income/cfo/capex + 每分部 revenue/op_income/op_margin/is_ai/kind 逐位相等），所以**数值主干可零漂移迁移**；但 **gross 与 forecast 是结构性缺口**，硬迁会让毛利/预测行从界面消失（回归）。因此 B2 的正解是**分层、诚实的部分迁移**：先迁「零漂移、纯收益」的**展示锚**（closes #13），把**数值行迁移**作为契约备好、但**门控在 annual period 的 gross_profit 补录**之后，绝不做「数字来自 periods、毛利/预测来自 years」的半迁移。

---

## 一、消费方普查（谁读 years[] 的什么）

### A. data-module.js 中读 `years[]` 的 selector

| # | selector | 读 years[] 的方式 | 服务的视图 | 本批处置 |
|---|---|---|---|---|
| 1 | `actualYears(c)` | `c.years` filter status=actual | 一切年度派生的地基 | 保留（B3 aiShare / niYoY 也用，跨链共享） |
| 2 | `latestActual(c)` | actualYears 末位 | 首页/公司页 headline 锚、AI 池 | **展示锚**改读 `latestActualAnnual`（见 D1） |
| 3 | `forecastYear(c)` | `c.years` find status=forecast | 预测行/前瞻 | **栅栏（B4）**，不动 |
| 4 | `yearIndex/yearByFy(c,fy)` | index into `c.years` | 下钻页按 fy 定位 | 见 D2（需 periods 侧等价物才能迁） |
| 5 | `revYoY(c,fy)` | `c.years[i-1].revenue` | 首页/年度表/下钻同比 | 见 D2（跨年、years 索引） |
| 6 | `segYoY(c,fy,name)` | `c.years[i-1].segments` | 下钻分部同比 | 见 D2（跨年、years 索引） |
| 7 | `niYoY(c)` | actualYears 末两年 net_income | EvVsGrowth（估值图） | 保留（值等价；估值相邻，随 B3/独立评估） |
| 8 | `latestCashYear(c)` | actualYears reverse 找现金年 | 公司页现金卡 / homeMetric fcfMargin·capexInt | 见 D3（现金年阶梯，可迁 `latestCashActualAnnual`） |
| 9 | `homeMetric(c,key)` | latestActual + latestCashYear | 首页指标列 | revenue/netIncome/netM/fcfMargin/capexInt 分支随 2/8 迁 |
| 10 | 对象入参派生族 | 入参是一个 year 对象 | 全年度视图 | **对 object-swap 透明**（见「分部/入参透明性」）——除 `incomeFlow` 的 gross 分支 |

对象入参派生族（#10）：`netMargin / opMargin / capexIntensity / fcf / fcfMargin / cashConversion / revenueSegs / revenueSorted / revenueTotal / segRevShare / segmentKind / reconcile / hasSegmentProfit / profitSorted / segOpMargin / incomeFlow`。它们只读入参对象的 `revenue/op_income/net_income/cfo/capex/segments/gross_*` 字段，**不关心对象来自 years 还是 periods**——把入参从 year 对象换成 annual period 对象即透明生效（字段同构，见平价表）。唯一例外是 `incomeFlow` 的毛利分支（读 `gross_profit` 优先、`gross_margin` 回退），见「三、gross」。

> 注：`Store.populated()/pending()`（L30–31）用 `c.years.length` 做补录门禁——这是**存在性判定**非年度展示，且改它会误伤未来 periods-only 公司，**栅栏不动**。

### B. web/ 组件中读 years[] 的路径（selector 或直读）

| 组件 | 读 years[] 的入口 | 展示字段 | 本批处置 |
|---|---|---|---|
| **ValuationCard.svelte** | `latestActual(company)` → L82 `${la.fy} 业绩` | 财年锚 label（**仅 fiscal_year 字符串**） | **D1 迁 latestActualAnnual**（#13，零可见变化） |
| **Home.svelte** | `latestActual` L118/230、`revYoY(c,la.fy)`、`homeMetric` | `r.la.period_end`(自由文本)/`.fy`、同比、指标值 | 锚 label 见 D1 决策点 b；指标值随 #2/#8 |
| **Company.svelte** | `latestActual`(KPI卡)、`c.years` 直读(yearRows/forecastRows)、`revYoY`、`latestCashYear`(现金卡)、`actualYears`(gate) | fy/rev/ni/netMargin/**gross_margin**、年度表、预测表、现金卡 | actual 数字见 D2；**gross 见三**；forecast 栅栏 |
| **Detail.svelte** | `yearByFy(c,fy)`(actual 下钻)、`revenueSorted/segRevShare/segYoY/reconcile/hasSegmentProfit/profitSorted/segOpMargin`、`reportable_note`；forecast 分支 anchors/consensus/framework_change | 全年度下钻面 + 桑基 + 分部三态 | actual 见 D2；**gross_margin(L204) 见三**；forecast/period 分支不动 |
| **Sankey.svelte** | `incomeFlow(y)` + L28 直读 `y.gross_margin` + `opMargin/netMargin` | 利润表资金流 | incomeFlow 已 period-ready；**gross 见三**；数值随 D2 |
| **Trend.svelte** | **直读** `company.years`（全序列，含 forecast） | 逐年 rev/ni/netMargin 双柱+折线 | **栅栏**：需含 forecast 的完整年度序列 → periods 缺 forecast，B4 后再议 |
| **EvVsGrowth.svelte** | `niYoY(company)`、`actualYears(company).length` | 净利同比 vs EV | 保留（估值相邻，值等价） |

**普查结论：7 个组件、约 9 个 selector 家族读 years[]；其中年度展示型 years 读取路径分四类**——(i) 展示锚（ValuationCard/Home，可零漂移迁）；(ii) actual 年数值行（Company/Detail/Sankey，数值可迁但需 periods 侧年度序列 selector + YoY 等价物）；(iii) **gross 毛利（结构性缺口，periods 无数据）**；(iv) **forecast 行 / Trend 全序列（periods 无 forecast，属 B4）**。

---

## 二、平价实测（硬门禁）——14 家逐家逐年

脚本：`scratchpad/parity_b2.py`（不入库），实跑当前 `companies.json`。判据 `|a−b| ≤ max(0.001, 1e-6·|a|)`；枚举值（is_ai/kind）全等。对每家每个 actual 年，按 `fiscal_year` 匹配 annual actual period，逐字段比对 headline 流量字段与每一分部。

**结果：945 / 945 单元 0 不一致。**

- **Headline 流量字段**（revenue / op_income / net_income / cfo / capex）：14/14 家、逐年逐字段 bit-identical（这些正是 ROADMAP D5 双写的字段）。
- **分部**（每家每年每个 segment 的 revenue / op_income / op_margin / is_ai / kind）：名字集完全一致（无缺席/多余），每字段逐位相等。→ **`revenueSegs/revenueSorted/segRevShare/reconcile/hasSegmentProfit/profitSorted/segOpMargin/segmentKind` 把入参从 year 换成 annual period 对象完全透明**（回答任务的「入参对象换成 period 对象是否透明」：**是**，字段同构、segments 形状一致）。
- **派生视图**（netMargin/opMargin/capexIntensity/fcf/fcfMargin/cashConversion/incomeFlow 的非 gross 部分）：其输入全在上两类内且逐位相等 → 输出**必然逐位相等**，无需单列。

**唯二不相等的结构性差异（非数据 bug，是 periods 侧尚无该事实）：**

1. **gross（毛利）**：`years[].gross_margin`（比率，14 家中约 8 家有值）vs `periods annual.gross_profit`（绝对值，**24/24 全为 null**）。periods 侧**根本没有毛利事实** → 若把 gross 显示迁 periods，则毛利/毛利率从所有年度视图消失（回归）。详见三。
2. **forecast 年**：8 家有 `years[]` forecast（nvda FY2027E / broadcom·tsmc·asml·google·microsoft·amazon FY2026E / oracle FY2027E），**periods[] forecast = 0 家**。年度表/趋势/前瞻的预测行在 periods 侧无源。详见四。

---

## 三、gross（毛利）——已知差异点 ①，处理建议

**事实**：schema 里 `years[].gross_margin` 存**比率**，`periods.gross_profit` 存**绝对值**；两者是不同表示，且 annual period 的 `gross_profit` 当前 **100% 为 null**。`incomeFlow` selector **本身已 period-ready**（`test-logic.js` L99–111 明确覆盖「period 存 gross_profit 而非 gross_margin」，selector 读 gross_profit 优先、gross_margin 回退）——所以这**不是 selector 缺口，是数据缺口**。

**建议（推荐）：gross 显示在 annual period 补录 `gross_profit` 之前，一律保留 years[] 源，不迁、不从 periods 派生。**

- 理由：periods 侧 gross_profit 全 null，若视图改读 periods 派生 `gross_profit/revenue`，结果对 14 家全部变 null → 毛利/毛利率整列消失，违背「留空也比填错好」的反面（这是「本有数据却被迁没」）。
- 具体：`Company.svelte` KPI 卡 `la.gross_margin`（L41）、`Detail.svelte` actual 年 `y.gross_margin`（L204–205）、`Sankey.svelte` `y.gross_margin`（L28）**继续读 years[] 口径**，即使其余数字迁到 periods（见 D2 的「混源边界」讨论）。
- **不要**把 gross 纳入双写一致性校验（periods 无该字段，强制会全 fail）。

**全量迁移的前置数据任务（非本批，交数据侧）**：给 annual actual periods 补录**真实披露的 `gross_profit`**（从财报原始事实采集，不是 `gross_margin×revenue` 反算——反算是「派生塞回原始层」，违背不变量 1）。补录后，`incomeFlow` 与桑基毛利带自动点亮，届时才谈把 gross 显示迁 periods。这是 B2 全量迁移的**硬前置**，独立排期。

---

## 四、forecast（预测年）——已知差异点 ②，处理建议

任务问：年度表若整体迁 periods，forecast 行从哪来？评估两方案：

- **方案 A（推荐）**：年度表 **actual 行走 periods、forecast 行仍读 `years[]`**，并明确标注 forecast 归 **B4（前瞻）**。理由：forecast 承载 `anchors / consensus_rev / consensus_eps / consensus_eps_value / framework_change` 一整套**前瞻专属字段**（schema 只在 `year` 定义、`period` 无），且 `forwardPE` 已明确划归 B4。把 forecast 强行拉进 periods = 提前做 B4、且要给 `period` 加一批前瞻字段，蔓延污染。
- **方案 B（不推荐）**：本批给 periods 引入 forecast annual 形状契约（`kind=annual, status=forecast` + consensus 字段）。代价：schema 扩字段 + 数据双写 forecast + 与 B4 的 `forwardPE` 迁移强耦合，且当前 0 家有此数据 → 是一段无数据支撑的空契约。

**推荐 A**：actual/forecast 天然分属不同批次与不同 selector（`latestActualAnnual` vs `forecastYear`），本就该分道。`Detail.svelte` 的 forecast 分支、`Company.svelte` 的 `forecastRows`、`Trend.svelte` 的全序列**整体栅栏留守 years[]**，随 B4 一并处理。

---

## 五、决策（契约）

### D1 — 展示锚迁移（本批**推荐执行**，closes #13，零漂移）

把「最新实际财年」这个**展示锚**从 `latestActual` 切到已存在的 `latestActualAnnual`（B1 已建，periods 侧最新实际 annual）：

- **ValuationCard.svelte L13/L82**：`la = latestActual(company)` → `latestActualAnnual(company)`；L82 显示 `${la.fy}` → `${la.fiscal_year}`。
  - 字段映射 `.fy`（"FY2026"）→ `.fiscal_year`（同值 "FY2026"，见 B1 映射表）。**显示字符串逐字不变，快照零 diff。** 这正是 #13 review 项：估值卡的分母已是 periods（B1），锚 label 也应来自同一 periods 脊，口径自洽。
- **契约**：`latestActualAnnual(c)` 返回 annual period 对象，`.fiscal_year` 对齐 `latestActual(c).fy`（双写保证、平价已证）。null 时（无 annual period）label 降级为 `'业绩'`（现有 `la ? ... : '业绩'` 三元已处理）。

### D2 — actual 年数值行迁移的契约（本批**备好、门控执行**）

若要把 Company/Detail/Sankey 的 **actual 年数字**迁到 periods，需要一个 periods 侧年度序列 selector（当前只有「取最新一条」的 `latestActualAnnual`，缺「按 fy 取任意一年」与「相邻年同比」）：

```
actualAnnuals(c)      → 升序（period_end）的 kind=annual & status=actual period[]（可为空）
annualByFy(c, fy)     → actualAnnuals 中 fiscal_year===fy 者，无 → null   （替 yearByFy 的年度用）
annualRevYoY(c, fy)   → 该 annual 与其前一 annual 的 revenue 同比           （替 revYoY 的年度用）
annualSegYoY(c,fy,nm) → 同上，分部 revenue 同比                             （替 segYoY 的年度用）
```

- 返回**原始 period 对象**，字段映射：`fy`→`fiscal_year`、`period_end(自由文本)`→`period_end(ISO)`、`gross_margin`→**无对应（见三，保留 years）**、`op_income/net_income/cfo/capex/segments/sources` 同名同构。
- 迁移后：`Detail` actual 分支的 `y` 来源、`Company` 的 KPI 卡/年度表数字、`Sankey` 的 incomeFlow 入参改用 annual period；**gross 显示仍读 years（三）、forecast 仍读 years（四）**。
- **数值全等**（平价 945/945），但这是**新增 selector 面 + 一处「混源」**：同一下钻页数字来自 periods、毛利来自 years。

**架构建议：D2 不在本批单独落地。** 把 actual 数值行迁 periods **门控在三的 gross_profit 补录完成**，届时把「actual 数字 + gross + （B4 后）forecast」作为**一个连贯单元**整体迁移，避免一个下钻页长期两个脊供数（认知负担 + 双倍回归面 + 无用户收益，因数值本就全等）。本批只把 D2 契约写死备用。

### D3 — 现金年阶梯（可随 D2）

`latestCashActualAnnual`（B1 已建）与 `latestCashYear` 语义镜像；`homeMetric` 的 fcfMargin/capexInt 与 `Company` 现金卡若迁，用它替 `latestCashYear`。平价：14 家最新 annual 都带 cfo/capex，`latestCashActualAnnual == latestCashYear` 逐家等价。同样建议随 D2 门控，不单迁。

### D4 — validate.py 双写一致性**扩字段**（本批**推荐独立执行**，与视图迁多远无关）

现 B1 规则（validate.py L368–407）只钉 `revenue/net_income` 两字段。B2 的年度数值视图额外展示 `op_income/cfo/capex` 与**分部** → 双写脊必须对这些字段也可信。

> **B2 配套（推荐硬 ERROR）**：把双写一致性校验的比对字段从 `{revenue, net_income}` 扩到 `{revenue, net_income, op_income, cfo, capex}`；并对匹配到的 annual period 与 years 记录，逐分部（按 name）比对 `revenue / op_income / op_margin / is_ai`。任一缺失/超容差 → ERROR。
> **不纳入 gross**（periods 无 gross_profit，见三）。

- **今日零摩擦**：平价 945/945 全等 → 扩规则当天全绿，纯粹把「双写纪律」从 2 字段收紧到全 headline+分部，锁死 periods 脊供年度视图消费的可信度。
- 价值独立于视图迁移进度：即便 D2 门控延后，这条也该先上，因为它是「periods 年度脊可信」的机器化保证。

---

## 六、回退策略建议

**沿用 B1：纯 periods、无运行时 years 回退；由 validate.py（D4 扩字段）在闸门硬 ERROR 兜底。** 但 B2 有两处**如实的局部保留**，不硬迁：

1. **gross 显示保留 years[] 源**——不是「回退」，是 periods 侧无此事实（数据缺口）。补录 gross_profit 前，这是唯一诚实选择。
2. **forecast 行 / Trend 全序列保留 years[]**——归 B4，periods 无 forecast。

对**已迁部分**（D1 锚；D2/D3 若执行的 actual 数字）：无 annual period → 相应显示留 null/降级，**绝不回退 years 补齐**（符合 B1 的「出生即死回退是负债」判断；双写一致性由 D4 在闸门挡住「有 years actual 却无对应 annual」）。

---

## 七、honesty 语义

- **gross**：periods 无 gross_profit → 若误迁会全 null（本有数据被迁没，是回归而非诚实）。故保留 years[].gross_margin 显示；`Detail` L204、`Company` KPI、`Sankey` L28 的「未披露」留空逻辑对 years 口径不变。
- **D1 锚**：`latestActualAnnual` 为 null（无 annual period）→ 锚 label 降级为「业绩」，不借 years 补（现有三元已处理）。
- **actual 数值（若迁）**：某年缺 annual period → 该年不显示，不回退 years。双写一致性（D4）保证「有 years actual 必有对应 annual」，故构造上安全。
- **分部三态不变**：`hasSegmentProfit / seg_profit` 三态分流（不变量 4）对入参 object-swap 透明——annual period 与 year 的 segments 逐位相等（平价证），三态判定不变。
- **对账不变**：`reconcile(period)` 与 `reconcile(year)` 因 segments+revenue 全等 → platform 合计=营收 的强制对账结果逐位不变（不变量 3）。

---

## 八、测试与快照计划

### test-logic.js（合成用例，不因数据刷新而改）
- `incomeFlow` 的 period 形状用例**已存在**（L99–111 gross_profit-only）——无需新增，反证 selector 已 period-ready。
- 若执行 D2：新增 `actualAnnuals / annualByFy / annualRevYoY / annualSegYoY` 的合成用例——夹具补 `periods[]` annual actual（含 segments），断言年度数值/同比与 years 口径等值；诚实退化：缺 annual → null、单年无前序 → YoY null。
- 若执行 D4：validate 侧构造「op_income/cfo/capex/分部 不一致」的临时无效 JSON，断言 ERROR（不入库）。

### test-snapshot.js（真实数据快照）
- **D1（锚）：预期零 diff**——`la.fiscal_year` === `la.fy` 逐字相等（"FY2026"）。若出现 diff → 某家 annual period 的 fiscal_year 与 years.fy 不同步（数据 bug），先修数据。
- **D4（validate 扩字段）：预期零新增 ERROR**——平价 945/945 全等保证。
- **若执行 D2/D3：actual 数值预期零 diff**（平价全等）；**gross 与 forecast 显示零变化**（未迁）。任何 diff 即数据不同步信号，先修数据而非改快照。

### Home 锚的可见性注意（决策点 b）
`Home.svelte` L230 显示 `r.la.period_end`——这是 years[] 的**自由文本**（"截至 2024-01-28"）；annual period 的 `period_end` 是**机读 ISO**。若把 Home 锚也迁 `latestActualAnnual`，该行文本从自由文本变 ISO 日期，**是可见变化**（非数值）。ValuationCard 只显示 `.fy`（→`.fiscal_year` 同字符串）故零可见变化。→ Home 锚迁与否交决策点 b。

---

## 九、范围栅栏（本批**不动**）

| 不动项 | 归属/原因 |
|---|---|
| `forecastYear` / 预测行 / `forwardPE` / consensus_* / anchors / framework_change | **B4（前瞻）**；periods 无 forecast |
| `Trend.svelte` 全年度序列（含 forecast） | 需 forecast annual periods → B4 后 |
| `aiShare` / `profitPoolAI` / `profitPoolMigration` / `profitPoolLeader` / is_ai 归因 | **B3（AI 池）**——aiShare 仍读 `latestActual` 的 is_ai 分部 |
| `quarters` 相关 / `companyMetricView` 四镜头 | 已是 periods（Phase 6 / Phase 4），非本批 |
| `gross` 显示迁 periods | 门控在 gross_profit 补录（三），本批只保留 years 源 |
| `Store.populated()/pending()` 的 `years.length` 门禁 | 存在性判定，改则误伤 periods-only 公司 |
| schema.json `year`/`period` 结构 | 无字段增删；D4 只扩 validate 比对字段，不改 schema |

---

## 十、需要用户 / 主会话拍板的决策点

1. **B2 执行范围**（核心）：
   - **(a) 推荐**：本批只做 **D1（展示锚，closes #13，零漂移）+ D4（validate 双写扩字段，独立硬化）**；D2/D3 的 actual 数值行迁移**契约备好、门控在 gross_profit 补录**后与 gross/forecast 整体迁。
   - (b) 激进：本批连 D2/D3 一起迁 actual 数值（数值全等），接受下钻页「数字来自 periods、毛利来自 years」的**混源过渡态**。架构师**不推荐**——数值本就全等（无收益），却新增 selector 面 + 双脊供数 + 双倍回归面。
2. **Home 锚是否随迁**：ValuationCard 锚迁是零可见变化（推荐迁）；Home L230 迁则「截至…」自由文本变 ISO 日期（可见变化）。选：Home 锚**保留 years[] 自由文本**（推荐，视觉零变）/ 改显 fiscal_year（丢自由文本，交设计师）/ 一并迁显 ISO。
3. **D4 严格度**：双写一致性扩到 `op_income/cfo/capex/分部` 是**硬 ERROR** 还是先 WARN 一轮？推荐直接 ERROR（今日 945/945 全绿，零摩擦）。
4. **gross_profit 补录**（前置数据任务）：确认由数据侧从财报采集**真实披露的 gross_profit** 补入 annual periods（不用 `gross_margin×revenue` 反算），作为 gross 显示全量迁 periods 的硬前置。是否本轮排期？

拍板后落地清单（若取推荐范围 a）：改 `ValuationCard.svelte`（1 处锚，交工程师，视图层唯一改动）+ 扩 `validate.py` 双写字段（D4）+ 补 test-logic/validate 用例；快照预期零 diff。落地后跑：`python3 validate.py companies.json schema.json` · `bun test-logic.js` · `bun test-snapshot.js` · `cd web && bun run build`。
