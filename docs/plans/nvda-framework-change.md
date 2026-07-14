# ADR: NVIDIA FY2027 报告框架变更的数据契约

- 状态: 提案（Proposed）——本 ADR 只定契约与边界，不动生产代码/数据；落地另启批次。
- 日期: 2026-07-14
- 触发: D8 批次② 发现 NVIDIA 自 Q1 FY2027 起变更报告框架（报道称市场平台口径由五平台改为 Data Center / Edge Computing），与库内既有 `segments[]` 口径冲突。
- 作用域: 仅 `nvda`，但确立"同一公司跨期口径变更"的通用契约，其它公司复用。

---

## 一、库内实况普查（先核事实，不臆测）

用 `validate.py companies.json schema.json` + selector 复刻脚本（`scratchpad/probe.py`）实测，结论如下。

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
- 现值: 仅 FY2027E 挂了一条，内容还把新框架说成"Data Center / Edge Computing 两平台"。

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
  - `nvda:market_platform:v2-fy27`（FY2027 起的 Data Center/Edge 新平台）
- 位置：加在 `year` 与 `period` 两级（与它们各自的 `segments[]` 平行）。
- **`kind` 不承载口径身份**：`kind`（platform/division/reportable）继续只驱动**对账语义**（它决定对账分区），不超载成"口径版本"。口径版本由 `segment_framework` 单独承载。二者正交。

**理由**：单一 opaque token 就能同时解决 (a) 跨期可比性判定 (b) 视图按口径分组/标注，且不触动既有 `kind` 的对账语义。opaque 而非枚举，是因为"哪些口径算同一版本"是公司特定的历史事实，不宜硬编码成全局枚举。

### D2 — 跨口径的 YoY / segYoY **一律 null**（堵住 §1.4 实测的重名失真）

**决策**：selector 的 seg 级同比（`segYoY` 及派生层任何按分部的跨期比较）改为：

- 两期都带 `segment_framework` 且**相等** → 照算。
- 两期 `segment_framework` **不等** → **null**（口径断裂，不可比）。
- 任一期**缺** `segment_framework` → 回退现有 name-match 行为（**非破坏**：其它 13 家单口径公司所有年份隐含同口径，name-match 本就正确，不受影响）。

**理由**：实测证明纯 name-match 会在重名时算出误导值（FY2027 DC=0.471）。加一道 framework 门即根治。**注意：这是落地批次的代码改动；本 ADR 只定字段与规则，代码不在本批。** 落地时须加测试：跨 framework 的 segYoY 必须断言为 null。

### D3 — 旧期**默认不重述**，双轨并存；官方 recast 才可追加、绝不自算

**背景**：NVIDIA 会在 10-Q 给旧期按新口径的 recast 对比。项目原则：「数据层不迎合派生逻辑」「留空也比填错好」。

**决策**：

1. 已录旧期（FY2024–26）**保持原口径原值不动**——它们是当时的 as-reported 事实，带 `segment_framework=...:v1`。
2. 新框架从 FY2027 起以新 token 落库。
3. 跨口径 YoY 走 D2 → null，视图用 `framework_change` 文案解释断裂（见 D5），**不画误导连线**。
4. **默认不录 recast**。仅当 NVIDIA **官方发布**了旧期按新口径的重述数字（`data_status=official`）且团队确有连续 YoY 需求时，才另启批次评估：把 recast 作为**带不同 `segment_framework` token 的独立分部组**追加（不覆盖原值、不参与对账/双写钉子——见下），而**绝不自行换算**旧期。
   - 若采用 recast，一个 period 的 `segments[]` 内会同时存在两套 framework 的条目，会破坏"平台合计=营收"对账（两套各自 sum 到营收，合起来是 2×）。因此 recast **不能**塞进同一 `segments[]`。落地时的容器方案（`segments_recast[]` 还是按 framework 分组对账）留给 recast 批次决策，**本 ADR 不预设**、只钉死原则："对账/双写只认 as-reported 当期口径那一套"。

**理由**：最小破坏、诚实优先。断裂本身是真实的，摊平它才是造假。

### D4 — revenue_breakdown 与 segments 分工：DC 内 Compute/Networking 挂 **revenue_breakdown**

**背景**：命名碰撞（§1.2.3）。"DC→Compute/Networking 内拆"是 Data Center 平台内的产品营收细拆，不是法定分部。

**决策**：

- **DC 内 Compute vs Networking 营收拆分 → `revenue_breakdown`**（层级：`Data Center → {Compute, Networking}`），**不进 `segments[]`**。
- `segments[]` 只承载**框架级平台/分部**（FY2027 起 Data Center / Edge Computing，或法定 reportable 分部）。
- 理由：(1) schema 已明确 segments=分部/平台轴、revenue_breakdown=产品/营收类型轴，二者刻意分离；(2) Compute/Networking 只有营收无独立利润，天然是 breakdown；(3) breakdown `complete=true` 时"含子节点必对账到子"，正好容纳 `Data Center → {Compute, Networking}`（`RB_TOL≤$1M`）。
- **命名去碰撞**：breakdown 里用产品名（如 `Compute`、`Networking`）；法定分部若录，用全名 `Compute & Networking`。文档/采集规格显式提示二者不同物。

### D5 — `framework_change` 的正式语义与 validate/UI 行为

**决策**（把它从"随手文案"升为"口径断裂的显式信号"）：

- **语义**：人读说明——"本财年/期起 segment 口径发生不可回溯变更"。与 machine-readable 的 `segment_framework` **版本跳变**联动：`framework_change` 文案 = 断裂点的人话解释，`segment_framework` 变更 = 断裂点的机器信号。
- **schema**：`framework_change` 从 `year` **扩展到 `period`**（period 也会跨口径）。类型仍 string，可选，非破坏。
- **validate.py**（落地批次）：
  - 当相邻同轴期的 `segment_framework` 发生变化，**SHOULD** 存在 `framework_change` 说明——缺失给 **WARN（非 ERROR）**，诚实提示而非硬拦。
  - 断言：跨 framework 若 selector 仍产出非 null 的 segYoY，是逻辑 bug（测试兜底）。
  - 对账闸判定"完整分区强制对账"仍按 `kind`（platform/reportable 都强制、division 不强制）；`segment_framework` 不改对账语义。
- **UI**（已有基础）：`Detail.svelte` 已显示"本财年起板块划分有变"。扩展：迁移图/趋势中跨口径的连线与 YoY 标注**显式呈现"口径断裂·不可比"**，而不是画一条误导连线（配合 D2 的 null）。

### D6 — AI 归因（is_ai）在口径切换下的连续性

**背景**：实测 aiShare proxy 随口径跳变（FY2026=0.897 → fy2027q1 reportable=0.913 → FY2027E 无段=null·DROP）。新框架 Data Center/Edge 若都判 is_ai=true → aiShare→~1.0，可能高估（Edge 未必全 AI）。

**决策**：

1. `is_ai` 是 segment 级布尔，**随口径走**——新框架落库时必须**逐分部重新判定** is_ai，**不继承**旧口径。
2. **消除口径切换致 AI 归因跳变的正解：优先给 NVDA 补 company 级 `ai_profit_share`（带 `ai_share_source`，`data_status=estimate/derived`）**。实测证明 `aiShare` 的 `sourced` 分支 year-agnostic、与 segments 口径**解耦**（不受框架变更影响），迁移图三根柱口径才不飘。
3. 若暂不补 `ai_profit_share`，则接受 FY2027 起 proxy 口径切换，并在文案/`valuation_caveat.note` 标注 AI 归因存在口径断点。

---

## 三、实测结论汇总（证据入档）

脚本：`scratchpad/probe.py`（复刻 revenueSegs/revenueTotal/segmentKind/reconcile/segYoY/aiShare）。

| 实测项 | 结论 |
|---|---|
| segYoY 跨口径 | 按 name 裸匹配；**重名即照算出不可比值（模拟 FY2027 DC=0.471，失真）**；非重名 → null。→ 必须加 D2 的 framework 门。 |
| aiShare 连续性 | proxy 随口径跳变（0.897→0.913→null）；`sourced`(ai_profit_share) 分支与口径解耦。→ D6 推荐补 ai_profit_share。 |
| reconcile 混口径 | `reportable` 被当 `platform` 强制对账；fy2027q1 合计=营收=81.615 通过（NVDA reportable 是完整分区，行为正确）。 |
| 双写闸门 | 逐分部按 name 钉 rev/op/op_margin/is_ai/kind；现无 FY2027 annual 未触发；落库须两侧同口径同名同值否则硬 ERROR。 |
| validate 现状 | 279 OK/INFO · 0 ERROR 全绿；契约变更须保持旧数据全绿。 |

---

## 四、受影响的层 / 文件

| 层 | 文件 | 改动（落地批次，非本 ADR） |
|---|---|---|
| 契约 | `schema.json` | `year`/`period` 新增可选 `segment_framework`(string)；`period` 补 `framework_change`(string)。均可选、非破坏。 |
| 校验 | `validate.py` | 相邻同轴期 framework 跳变缺 `framework_change` → WARN；跨 framework segYoY 非 null 的测试断言；对账/双写语义不变。 |
| 派生 | `data-module.js` | `segYoY`（及任何 seg 级跨期比较）加 framework 门：两侧有且不等 → null，缺失 → 回退 name-match。 |
| 呈现 | `web/src/components/Detail.svelte` 等 | 跨口径 YoY/迁移连线显式标"口径断裂·不可比"。 |
| 数据修复 | `companies.json` | fy2027q1 两分部 `kind`: `platform → reportable`；给 NVDA 各期补 `segment_framework` token；推荐补 `ai_profit_share`+`ai_share_source`。 |

---

## 五、给采集端的补录规格（DC→Compute/Networking 及新框架）

来源：NVIDIA 10-K / 10-Q MD&A『Revenue Trends by Market Platform』及分部附注。原则：诚实留空 > 填错；每条带 `url`+`data_status`。

1. **DC 内 Compute/Networking 营收细拆** → 挂 `revenue_breakdown`（**不进 segments**）：
   - 结构：`label` 如 "按市场平台/产品营收"，`items` 含 `Data Center` 节点，其 `children=[{Compute,…},{Networking,…}]`；`complete` 视是否覆盖全部营收而定（`complete=true` 则顶层须对账到营收、含子节点对账到子，容差 ≤$1M）。
   - 产品名用 `Compute`/`Networking`，**勿**与法定分部 `Compute & Networking` 混名。
   - 双写：年度事实须 years 与 annual period **两侧同写整树**（`validate.py` 深比较）。
2. **FY2027 新市场平台框架**（Data Center / Edge Computing）→ 进 `segments[]`：
   - `kind=platform`；`segment_framework="nvda:market_platform:v2-fy27"`；逐分部**重判 is_ai**（Edge 是否全 AI 按实际口径，勿默认继承）。
   - 完整平台集须对账到营收（强制）。
   - 对应 year 挂 `framework_change` 文案（当前 FY2027E 那条要按实际落地的口径改写；现文案说的"两平台"待官方确认）。
3. **fy2027q1 现存 reportable 分部**（Compute & Networking / Graphics）：
   - 修 `kind`: `platform → reportable`；补 `segment_framework="nvda:reportable:v1"`。
   - 保留 op_income（这是 NVDA 唯一有分部利润的口径，`seg_profit` 价值所在）。
4. **旧期（FY2024–26）**：补 `segment_framework="nvda:market_platform:v1"`，值不动。
5. **AI 归因**（推荐）：补 company 级 `ai_profit_share` + `ai_share_source`，让迁移图跨口径连续（D6）。
6. **落库后必跑** `python3 validate.py companies.json schema.json`，确认旧数据仍 0 ERROR，且 fy2027q1 与新框架各自对账通过。

---

## 六、范围栅栏

本 ADR **只定契约与规则**，不改任何生产代码/数据。schema 字段的实际写入、validate/selector/UI 的配套实现、数据修复与补录，均属后续独立批次。

---

## 七、需产品/团队拍板的点

1. **是否补 `ai_profit_share`**（D6）——涉及采集成本 vs 迁移图 AI 归因跨口径连续性，属产品优先级，请 PM 定。
2. **新框架到底几个平台**——现 FY2027E 文案写"Data Center / Edge Computing 两平台"，但 D8 报道措辞是"新增 Data Center / Edge 等"。落库前须以 NVIDIA 官方 Q1 FY2027 10-Q 为准核实（采集端）。
3. **旧期是否要 recast**（D3）——默认不录；若团队要连续 YoY，需官方 recast 数字到位后另启批次评估容器方案。
