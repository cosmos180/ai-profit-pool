# ADR: NVIDIA FY2027 报告框架变更的数据契约

- 状态: **已落地（Implemented，2026-07-14）**——契约机制本批已实现（schema/selector/validate/UI/数据顺修/测试/文档）。三个开放拍板点（ai_profit_share、新框架平台数、recast）**本批不做**，见 §七。落地记录见文末「落地记录」。
- 原状态: 已接受（Accepted，2026-07-14 review）——本 ADR 只定契约与边界，不动生产代码/数据；落地另启批次。
- 日期: 2026-07-14
- 触发: D8 批次② 发现 NVIDIA 自 Q1 FY2027 起变更报告框架（报道称市场平台口径由五平台改为 Data Center / Edge Computing），与库内既有 `segments[]` 口径冲突。
- 作用域: 仅 `nvda`，但确立"同一公司跨期口径变更"的通用契约，其它公司复用。

官方事实锚：

- [NVIDIA Q1 FY2027 earnings release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-First-Quarter-Fiscal-2027/default.aspx)：明确新框架为两个 market platforms——Data Center / Edge Computing；Data Center 下的新 sub-markets 为 Hyperscale / ACIE，并同时披露旧 sub-markets 下的 Compute / Networking。
- [NVIDIA Q1 FY2027 Form 10-Q](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000052/nvda-20260426.htm)：法定 reportable segments 仍为 Compute & Networking / Graphics；这与 market-platform 轴是同时存在的不同口径。

---

## 一、库内实况普查（先核事实，不臆测）

用 `validate.py companies.json schema.json` + review 临时 selector probe 实测，结论如下；关键断言将在落地批次固化到 `test-logic.js`。

### 1.1 NVDA 现有结构

- `years[]`: FY2024 / FY2025 / FY2026（actual）+ FY2027E（forecast）。
- `periods[]`: 三个 annual（FY2024/25/26）+ fy2026q1(rev=null)/q2/q3 + fy2027q1。

### 1.2 segments 口径**事实上已经混用**（这是本 ADR 的根因）

| 载体 | segments 口径（轴） | 分部名 | kind | 是否带利润 |
|---|---|---|---|---|
| years FY2024–26 & 对应 annual periods | **市场平台**（market platform） | Data Center / Gaming / ProViz / Auto / OEM（5） | `platform` | 无（`seg_profit=partial`，利润显式留空） |
| period **fy2027q1** | **法定 reportable 分部** | Compute & Networking / Graphics（2） | `platform` ← **错标** | 有 op_income（53.335 / 2.941） |
| year **FY2027E** | 无 segments，仅 `framework_change` 文案 | — | — | — |

关键订正三点：

1. **fy2027q1 的两个分部不是"新框架"**。Compute & Networking / Graphics 是 NVIDIA 沿用多年的**法定 reportable 分部**（带分部利润），与 `framework_change` 文案所指的"新市场平台 Data Center / Edge"是**两条不同的轴**。库里当前把它们标成 `kind=platform`，应为 `kind=reportable`（数据修复项，见 §5）。
2. 因此"口径混用"在**当前数据里就已存在**：年度=市场平台轴，fy2027q1=reportable 轴。二者本就不可跨期比。
3. 任务描述里的"DC→Compute/Networking 内拆"又是**第三条轴**：它是 Data Center **市场平台内部的产品营收细拆**（Compute vs Networking，来自 10-K MD&A『Revenue Trends by Market Platform』），与法定分部"Compute & Networking"**同名但不同物**。命名碰撞必须在契约里切开（见 §D4）。

### 1.3 `framework_change` 字段现有用法

- schema: 仅 `year` 上有，`{"type":"string"}`，无 machine 语义。`period` 上**没有**此字段。
- `validate.py`: **完全不消费**（grep 零命中）。
- 视图: 仅 `web/src/components/Detail.svelte:196` 显示"本财年起板块划分有变" + 文案。
- 现值: 仅 FY2027E 挂了一条；其中"Data Center / Edge Computing 两平台"已由官方 Q1 FY2027 release 证实，但断裂信号尚未落到首个实际期。

### 1.4 selector / 闸门对混口径的**实测**行为

- **segYoY（`data-module.js:211`）按 `name` 裸匹配**：`prev = prevYear.segments.find(s=>s.name===name)`。名字对不上就 null。
  - 实测：模拟 FY2027 落新框架 `[Data Center, Edge Computing]`（Data Center 与旧口径**重名**）：
    - `segYoY('FY2027','Data Center 数据中心')` = **0.471 ← 照算出值，但新 DC 含重分类内容，数值不可比（失真！）**
    - `segYoY('FY2027','Edge Computing')` = null（新名旧年无 → 诚实断裂）
    - `segYoY('FY2027','Gaming')` = null（旧名新年无 → 诚实断裂）
  - **结论：selector 无口径感知；只要新旧口径分部重名，就会算出误导性 YoY。这是必须堵的契约漏洞。**
- **reconcile / segmentKind（`:203/:205`）**：`segmentKind` 只区分 `division` vs 其它；`reportable` 落入 "platform" 分支被**强制对账**。fy2027q1 两分部合计 81.615 = 营收 81.615 → 对账通过（NVDA reportable 是完整分区，行为正确，但语义上"平台完整集强制对账"是被一个 reportable 集满足的）。
- **aiShare is_ai proxy（`:234`）**：随口径走。实测各期：FY2024=0.780 / FY2025=0.883 / FY2026=0.897（DC/分部合计）；FY2027E 无 segments → **null → NVDA 从该列 AI 加权池 DROP**；fy2027q1 reportable 口径 proxy=0.913（Compute&Networking/合计，口径与"Data Center"不同）。**口径切换会让 aiShare 跳变。**
- **双写闸门（`validate.py:471`）**：逐分部按 name 钉住 revenue/op_income/op_margin/is_ai/kind。现无 FY2027 annual period，故未触发；但一旦 years 与 annual period 两侧落 FY2027 分部，**两侧必须同口径同名同值**，否则硬 ERROR。
- 现状 `validate.py`：**279 OK/INFO · 0 WARN · 0 ERROR**（全绿）。任何契约变更都必须保持旧数据仍全绿。

---

## 二、契约决策（ADR）

### D1 — 允许同一公司跨期不同 segments 口径，但口径身份必须显式标注

**背景**：现状已混（§1.2），且 NVIDIA 官方就是要换口径，禁止混用不现实、也违背"数据层承载 as-reported 事实"。

**决策**：承认多口径共存，新增**期级口径身份**字段 `segment_framework`（string，opaque 版本 token）：

- 语义：标识"这组 segments 属于哪个口径版本"。同 token = 同口径可比；不同 token = 口径断裂。
- 命名约定（建议）：`<公司>:<轴>:<版本>`，例：
  - `nvda:market_platform:v1`（FY2024–26 的五平台）
  - `nvda:reportable:v1`（fy2027q1 的 Compute&Networking/Graphics）
- 位置：加在 `year` 与 `period` 两级（与它们各自的 `segments[]` 平行）。
- **`kind` 不承载口径身份**：`kind`（platform/division/reportable）继续只驱动**对账语义**（它决定对账分区），不超载成"口径版本"。口径版本由 `segment_framework` 单独承载。二者正交。

**理由**：单一 opaque token 就能同时解决 (a) 跨期可比性判定 (b) 视图按口径分组/标注，且不触动既有 `kind` 的对账语义。opaque 而非枚举，是因为"哪些口径算同一版本"是公司特定的历史事实，不宜硬编码成全局枚举。

### D2 — 跨口径的 YoY / segYoY **一律 null**（堵住 §1.4 实测的重名失真）

**决策**：selector 的 seg 级同比（`segYoY` 及派生层任何按分部的跨期比较）改为**失败关闭**：

- 两期都带 `segment_framework` 且**相等** → 照算。
- 两期都**不带** `segment_framework` → 回退现有 name-match 行为（其它尚未接入该契约的公司保持非破坏）。
- 两期 token **不等**，或**只有一期有 token** → **null**（口径断裂或标注不完整，均不可比）。

**理由**：实测证明纯 name-match 会在重名时算出误导值（FY2027 DC=0.471）。若“任一期缺 token 就回退”，一次漏标便会重新绕过闸门；因此只有“两边都缺”才允许 legacy 回退。**注意：这是落地批次的代码改动；本 ADR 只定字段与规则，代码不在本批。** 落地时须至少覆盖三组测试：同 token 正常计算、异 token 为 null、单边缺 token 也为 null。

### D3 — 旧期**默认不重述**，双轨并存；官方 recast 才可追加、绝不自算

**背景**：NVIDIA 可能在后续文件给旧期按新口径的 recast 对比。项目原则：「数据层不迎合派生逻辑」「留空也比填错好」。

**决策**：

1. 已录旧期（FY2024–26）**保持原口径原值不动**——它们是当时的 as-reported 事实，带 `segment_framework=...:v1`。
2. FY2027 起 `segments[]` 主轴切到 reportable 轴并使用 `nvda:reportable:v1`；新的 market-platform 轴按 D4 落 `revenue_breakdown`。
3. 跨口径 YoY 走 D2 → null，视图用 `framework_change` 文案解释断裂（见 D5），**不画误导连线**。
4. **默认不录 recast**。仅当 NVIDIA **官方发布**了旧期按新口径的重述数字（`data_status=official`）且团队确有连续 YoY 需求时，才另启批次评估：把 recast 作为**带不同 `segment_framework` token 的独立分部组**追加（不覆盖原值、不参与对账/双写钉子——见下），而**绝不自行换算**旧期。
   - 若采用 recast，一个 period 的 `segments[]` 内会同时存在两套 framework 的条目，会破坏"平台合计=营收"对账（两套各自 sum 到营收，合起来是 2×）。因此 recast **不能**塞进同一 `segments[]`。落地时的容器方案（`segments_recast[]` 还是按 framework 分组对账）留给 recast 批次决策，**本 ADR 不预设**、只钉死原则："对账/双写只认 as-reported 当期口径那一套"。

**理由**：最小破坏、诚实优先。断裂本身是真实的，摊平它才是造假。

### D4 — 同期间多轴分工：`segments[]` 只留一套主轴，其余营收轴进 **revenue_breakdown**

**背景**：命名碰撞（§1.2.3）之外，Q1 FY2027 同时存在两套官方轴：法定 reportable segments（Compute & Networking / Graphics，带利润）与新 market platforms（Data Center / Edge Computing，仅营收）。单个 period-level `segment_framework` 无法同时描述两套 `segments[]`，把两套平铺进去还会双重计算营收。

**决策**：

- 一个 year/period 的 `segments[]` **只允许一套主轴**，由期级 `segment_framework` 标识；不得把两套各自完整对账的轴平铺到同一数组。
- NVIDIA 从 FY2027 起，`segments[]` 选择**法定 reportable 轴**（Compute & Networking / Graphics），因为它独有分部营业利润；`kind=reportable`，`segment_framework="nvda:reportable:v1"`。
- market-platform 营收轴进入 `revenue_breakdown`：FY2027 当前框架为 `Data Center / Edge Computing`，Data Center 的当前子市场为 `Hyperscale / ACIE`。它们不进 `segments[]`。
- 旧框架期可在 `revenue_breakdown` 记录 `Data Center → {Compute, Networking}`。同一期若官方同时给出新旧两套替代分类，canonical tree **只采用当期有效框架**；另一套留在 source note，除非未来另设支持多棵命名树的容器。禁止把两套 children 同挂一个 Data Center 节点造成双计。
- 旧期 FY2024–26 已存在的 market-platform `segments[]` 不追溯搬家，保留并标 `nvda:market_platform:v1`；FY2027 切到 reportable 主轴，segYoY 按 D2 诚实断裂。
- **命名去碰撞**：breakdown 里用 `Compute` / `Networking`；法定分部用全名 `Compute & Networking`。文档/采集规格显式提示二者不同物。

**理由**：(1) 解决同期间多轴而不引入 `segment_sets[]` 级别的大改；(2) 保住 reportable 轴唯一的利润信息；(3) `revenue_breakdown` 的逐层对账天然适合市场/产品收入层级；(4) 不改旧事实，只在断点后采用明确的主轴优先级。

### D5 — `framework_change` 的正式语义与 validate/UI 行为

**决策**（把它从"随手文案"升为"口径断裂的显式信号"）：

- **语义**：人读说明——"本财年/期起 segment 口径发生不可回溯变更"。与 machine-readable 的 `segment_framework` **版本跳变**联动：`framework_change` 文案 = 断裂点的人话解释，`segment_framework` 变更 = 断裂点的机器信号。
- **schema**：`framework_change` 从 `year` **扩展到 `period`**（period 也会跨口径）。类型仍 string，可选，非破坏。
- **validate.py**（落地批次）：
  - 对 selector 实际会相互比较的序列检查 token：`years[]` 的相邻 actual 年；`periods[]` 仅在同 `kind`、同季度/年度 cadence 的跨期比较存在时检查，不把 annual 与 quarter 硬相邻。
  - 上述序列 token 发生变化时，后一期 **SHOULD** 有 `framework_change` 说明——缺失给 **WARN（非 ERROR）**。
  - 一家公司只要任一含 segments 的 carrier 使用了 `segment_framework`，其余含 segments 的 carrier 缺 token 也给 **WARN**；selector 仍按 D2 对单边缺 token 失败关闭，不会产出误导值。
  - 断言：跨 framework 若 selector 仍产出非 null 的 segYoY，是逻辑 bug（测试兜底）。
  - 对账闸判定"完整分区强制对账"仍按 `kind`（platform/reportable 都强制、division 不强制）；`segment_framework` 不改对账语义。
- **UI**（已有基础）：`Detail.svelte` 已显示"本财年起板块划分有变"。扩展：迁移图/趋势中跨口径的连线与 YoY 标注**显式呈现"口径断裂·不可比"**，而不是画一条误导连线（配合 D2 的 null）。

### D6 — AI 归因（is_ai）在口径切换下的连续性

**背景**：实测 aiShare proxy 随 carrier 主轴跳变（FY2026 market-platform=0.897 → fy2027q1 reportable=0.913 → FY2027E 无 segments=null·DROP）。即使两套轴都来自官方，`is_ai` 聚合分母与业务边界不同，数值也不能当连续序列解释。

**决策**：

1. `is_ai` 是 segment 级布尔，**随口径走**——新框架落库时必须**逐分部重新判定** is_ai，**不继承**旧口径。
2. **本批不补 company 级 `ai_profit_share`。** 当前字段是 year-agnostic 常量，selector 会把同一个比例应用到所有年份；为了视觉连续而补一个静态估计，只会把可见的口径断点替换成不可见的“假连续”。除非未来获得真正适用于全历史期的独立来源，否则不得以消除跳变为目的填写。
3. FY2027 起接受 proxy 的口径切换或 `null`，并在消费点标注 AI 归因存在口径断点。若产品确需跨年连续 AI 归因，应另行设计带 `period/as_of` 的时点化字段，而不是复用当前 company-level 常量。

---

## 三、实测结论汇总（证据入档）

实测方法：review 临时 probe 复刻 `revenueSegs/revenueTotal/segmentKind/reconcile/segYoY/aiShare`（临时文件不入库）；落地批次必须把关键断言固化到 `test-logic.js`，不依赖一次性脚本。

| 实测项 | 结论 |
|---|---|
| segYoY 跨口径 | 按 name 裸匹配；**重名即照算出不可比值（模拟 FY2027 DC=0.471，失真）**；非重名 → null。→ 必须加 D2 的 framework 门。 |
| aiShare 连续性 | proxy 随口径跳变（0.897→0.913→null）；company-level `sourced` 虽能强制连续，却会把单一常量套给所有年份。→ D6 决定不以视觉连续为目的补值。 |
| reconcile 混口径 | `reportable` 被当 `platform` 强制对账；fy2027q1 合计=营收=81.615 通过（NVDA reportable 是完整分区，行为正确）。 |
| 双写闸门 | 逐分部按 name 钉 rev/op/op_margin/is_ai/kind；现无 FY2027 annual 未触发；落库须两侧同口径同名同值否则硬 ERROR。 |
| validate 现状 | 279 OK/INFO · 0 ERROR 全绿；契约变更须保持旧数据全绿。 |

---

## 四、受影响的层 / 文件

| 层 | 文件 | 改动（落地批次，非本 ADR） |
|---|---|---|
| 契约 | `schema.json` | `year`/`period` 新增可选 `segment_framework`(string)；`period` 补 `framework_change`(string)。均可选、非破坏。 |
| 校验 | `validate.py` | selector 实际比较序列的 framework 跳变缺 `framework_change` → WARN；接入 token 的公司有 segments carrier 漏标 → WARN；对账/双写语义不变。 |
| 派生 | `data-module.js` | `segYoY`（及任何 seg 级跨期比较）加 framework 门：同 token 才算；两边都缺才 legacy 回退；异 token 或单边缺失均 null。 |
| 呈现 | `web/src/components/Detail.svelte` 等 | 跨口径 YoY/迁移连线显式标"口径断裂·不可比"。 |
| 数据修复 | `companies.json` | fy2027q1 两分部 `kind`: `platform → reportable`；给 NVDA 各含 segments 的期补 `segment_framework` token；新 market-platform 轴写入 `revenue_breakdown`；不补静态 `ai_profit_share`。 |

---

## 五、给采集端的补录规格（DC→Compute/Networking 及新框架）

来源：NVIDIA 10-K / 10-Q MD&A『Revenue Trends by Market Platform』及分部附注。原则：诚实留空 > 填错；每条带 `url`+`data_status`。

1. **旧框架期的 DC 内 Compute/Networking 营收细拆** → 挂 `revenue_breakdown`（**不进 segments**）：
   - 结构：`label` 如 "按市场平台/产品营收"，`items` 含 `Data Center` 节点，其 `children=[{Compute,…},{Networking,…}]`；若顶层同时录齐 Gaming / ProViz / Auto / OEM 等全公司收入可设 `complete=true`，否则必须 false（含子节点仍须精确对账到父，容差 ≤$1M）。
   - 产品名用 `Compute`/`Networking`，**勿**与法定分部 `Compute & Networking` 混名。
   - 双写：年度事实须 years 与 annual period **两侧同写整树**（`validate.py` 深比较）。
2. **FY2027 新 market-platform 框架** → 挂 `revenue_breakdown`：
   - 顶层为官方已确认的 `Data Center / Edge Computing` 两平台；Data Center 只有在拿到精确值时才挂当前子市场 `Hyperscale / ACIE`。
   - 不把旧分类 Compute / Networking 与新分类 Hyperscale / ACIE 同挂一个 Data Center；二者是替代分类，不是四个可加总 children。
   - 对应首个实际期挂 `framework_change` 文案；FY2027E 的两平台说明保留，但不能替代实际期断裂信号。
3. **fy2027q1 现存 reportable 分部**（Compute & Networking / Graphics）：
   - 修 `kind`: `platform → reportable`；补 `segment_framework="nvda:reportable:v1"`。
   - 保留 op_income（这是 NVDA 唯一有分部利润的口径，`seg_profit` 价值所在）。
4. **旧期（FY2024–26）**：补 `segment_framework="nvda:market_platform:v1"`，值不动。
5. **AI 归因**：本批不补 company-level `ai_profit_share`；接受断裂并露出提示。未来若需要连续序列，另设计时点化字段。
6. **落库后必跑** `python3 validate.py companies.json schema.json`，确认旧数据仍 0 ERROR，且 fy2027q1 reportable segments 与新 market-platform breakdown 各自在自己的轴上对账通过。

---

## 六、范围栅栏

本 ADR **只定契约与规则**，不改任何生产代码/数据。schema 字段的实际写入、validate/selector/UI 的配套实现、数据修复与补录，均属后续独立批次。

---

## 七、review 拍板结果（2026-07-14）

1. **不补静态 `ai_profit_share`**：当前 company-level 常量不能表达跨年变化，不以假连续遮蔽断点。
2. **新框架确认是两个 market platforms**：Data Center / Edge Computing；Data Center 当前 sub-markets 为 Hyperscale / ACIE，均以 NVIDIA Q1 FY2027 官方 release 为准。
3. **旧期默认不 recast**：保留 as-reported；只有拿到官方精确 recast 且存在明确产品需求时，才另启容器 ADR，绝不覆盖旧值或塞进同一 `segments[]`。

---

## 八、落地记录（2026-07-14 实施批次）

**改动面**（对应 §四表）：

1. `schema.json`：`year` 与 `period` 上新增可选 `segment_framework`(string, opaque token)；`period` 新增 `framework_change`(string)。均可选、非破坏，缺字段的旧数据零行为变化。
2. `data-module.js` `segYoY`：加 framework 门（D2 失败关闭）——两期 token 皆存在且相等→照算；两期皆缺→legacy name-match（非破坏）；token 不同或单边缺→null。这是唯一的 seg 级跨期比较路径（`revenueBreakdownYoY` 是独立的产品/收入轴、不受 `segment_framework` 约束，未改）。
3. `validate.py`：新增 segment_framework 契约两条 WARN（非 ERROR）——**Rule A**（断裂需说明）：带 token 的 carrier 按时序相邻两两比较，token 跳变而无 `framework_change` → WARN；**Rule B**（完整性）：本公司任一含 segments 的 carrier 启用 token 后，其余含 segments 的 carrier 缺 token → WARN。对账/双写语义**不受 token 影响**，仍按 `kind`。
4. `web/src/components/Detail.svelte`：`framework_change` 展示升级为统一的「口径断裂·不可比」提示（复用 `.gap` amber caveat + `跨口径` badge），period / 实际年 / 预测年三分支共用一个 `{#snippet frameworkBreak()}`。
5. 数据顺修（`companies.json`）：nvda `fy2027q1` 两分部 `kind: platform → reportable`；年度（years FY2024–26 + annual periods）补 `segment_framework="nvda:market_platform:v1"`，`fy2027q1` 补 `"nvda:reportable:v1"` 并在断裂点加 `framework_change`。**未**写入 market-platform `revenue_breakdown`（待 Dayo 精确 $M，§5）。
6. 测试：`test-logic.js` 加 segYoY framework 门 6 例（同 token 正常/异 token null/单边缺 null/双缺 legacy/缺基期 null）；`test-snapshot.js` **零漂移**（无 --update）。

**两点实施解读（需主导者/架构师知悉）**：

- **Rule A 采用「token 驱动」而非「严格同 kind 相邻」**：D5 line 123 有「不把 annual 与 quarter 硬相邻」的告诫（针对 YoY cadence）。实施时 Rule A 只在**带 token 的 carrier 之间、且 token 真实跳变时**咬人，跨 annual↔quarter 也检测。对 nvda 现库，这使 `fy2026-annual`(market_platform) → `fy2027q1`(reportable) 的轴切换被识别为断裂点，从而**要求** `fy2027q1` 带 `framework_change`（与本批任务的预期一致）。因只在 token 变化处触发，正常同口径的连续期不会误报。
- **reportable 仍触发对账（依 D5，非任务括注）**：任务描述括注「reportable 不触发平台对账」与 ADR D5 line 127（「platform/reportable 都强制、division 不强制」）冲突。实施**遵从 ADR D5**：`validate.py` 对账分支只排除 `division`，故 `reportable` 与 `platform` 一样强制对账。`fy2027q1` 两分部合计 81.615 = 营收 81.615 → **对账通过**，行为与改 kind 前一致（kind 改动对对账闸零净效果，因两者同落「非 division」分支）。

**门禁结果**：`validate.py` 279 OK/INFO · 0 WARN · 0 ERROR；`test-data-module.js` 全过（logic + snapshot 零漂移）；`bun run build` 通过；dev + build 双验 nvda `fy2027q1` / `FY2027E` 详情页断裂提示均正确渲染（桌面 + 390px），无 pageerror。
