# A1 · 估值横截面 comps 表 — UX 设计方案

> 状态：设计稿（只出方案，不改生产代码）
> 缺口来源：分析师正式 DoD 验收裁定的头号缺口。买方原话——
> 「我拍板前要的是一屏并列所有名字的前瞻倍数，这工具逼我点进 14 个详情页手抄。
> 一屏并列：trailing PE｜前瞻 PE｜EV-Sales｜FCF yield，任一列可排序。没有这个，comps 对我等于没做。」
> 本波只做这一件。

---

## 0. 一句话结论

新建一个**顶层横截面视图 `comps`**（不塞进现有 bar 登记表、不埋进高级分析），承载一张
**14 行 × 4 估值列的可排序真表**（trailing PE｜前瞻 PE｜EV/Sales｜FCF yield，外加公司、环节两列语境）。
默认按**前瞻 PE 升序**（最便宜在上）、`—` 恒沉底。所有行/列/caveat/排序键由
`Selectors.compsTable()` 一次性备好，组件只持有「当前排序列 + 升降」这一个 UI 状态、只渲染。
诚实三态（na / distorted / 缺数据待补）在单元格里视觉分明，绝不用 0 或估算填坑。

---

## 1. 现状截图观察（本人已渲染 1280 桌面 + 390 窄屏）

截图存于 scratchpad：`home-desktop.png` / `home-pe.png` / `company-desktop.png` / `home-mobile.png`。

**首页登记表（`Home.svelte`）现在是「单指标切换的 bar 列表」：**
- 顶部一排 `.metricbar` chip：对比指标（营收/净利润/净利率/FCF 利润率/capex 强度）+ 估值（PE/PS/EV-Sales/FCF yield）。
- 点某个 chip → 整张 `.dir` 列表按**该单一指标**降序重排，每行右侧 `.cmetric` 只显示**这一个**数值 + 一根 `.cbar` 条。
- 点 PE 后（`home-pe.png`）：能看到「年度PE 376.1× / 124.1× …」按 PE 降序，但**一次只有一列**。要同时看某公司的 forward PE / EV-Sales / FCF yield，必须点进公司页。这正是分析师抱怨的「手抄 14 页」。
- bar 列表的 IA 天然是「一名字一大数 + 规模条」，为「谁最大/单指标排名」优化；塞四列数字进每行会撑爆行高、且 390 窄屏已把 `.cbarcell` 直接 `display:none`。**结论：bar 列表不该也无法承载横向 comps。**

**公司页估值卡（`ValuationCard.svelte`）：**
- `.kpis` 网格四张卡：PE / PS / EV-Sales / FCF yield，每张含数值 + 分母口径 + 同环节相对位（`同环节 3 家 · 中位 76.3× · 偏高(更贵)`）。
- 下方独立一张蓝色 `.fwd-pe` 卡（前瞻 PE，NTM·一致预期），与 trailing 严格分色（蓝 `--ai` vs 绿 `--ok`）。
- 这些**每公司一屏、竖排四卡**的呈现是详情页的正解，但它就是分析师要横过来并列的原料。comps 表本质＝把这套 selector 的输出转置成「公司为行、倍数为列」。

**关键数据事实（已用 data-module 跑实测，14 家 populated）：**

| 覆盖 | trailing PE | 前瞻 PE | EV/Sales | FCF yield |
|---|---|---|---|---|
| 有值家数 | 13/14 | **8/14** | 11/14 | 13/14 |

- 前瞻 PE 缺 6 家：Samsung、SoftBank、Micron、SK hynix、Tencent、Arm（缺 `consensus_eps_value`；SoftBank 是 na 而非缺）。
- EV/Sales 缺 3 家：Alphabet、Microsoft、Amazon（`net_debt` 未录 → EV 无法算 → 诚实留空，caveat 仍是 ok）。
- na（整项不适用）：SoftBank 的 pe / 前瞻PE / fcfYield。
- distorted（仍出值带警示）：Tencent pe=13.8×、SoftBank ps=4.2×/evSales=6.8×。
- 环节（7 个）：设计(NVIDIA/Broadcom/Arm)、代工(TSMC)、存储(Samsung/Micron/SK)、设备(ASML)、投资(SoftBank)、应用(Tencent)、云(Alphabet/Microsoft/Amazon/Oracle)。

---

## 2. 裁决一：放哪 → 新建顶层视图 `comps`

**现状**：横截面对比在产品里无处安放——bar 登记表是单列，高级分析是利润池迁移图。

**建议**：新增第四个顶层视图 `nav.view = 'comps'`（与 home/analysis/company/detail 平级），
入口放在**首页最显眼处**——把现有 `.analysis-entry` 那块改造/新增为**两个并列入口卡**：

```
┌─────────────────────────────┬─────────────────────────────┐
│ 估值横截面  ★               │ 高级分析                     │
│ 一屏并列四倍数 · 任列排序    │ AI 归因、利润池迁移、结构判断│
│              [ 打开对比表 → ]│            [ 利润池迁移 → ]   │
└─────────────────────────────┴─────────────────────────────┘
```

估值横截面入口视觉权重更高（主色描边/★），因为它是分析师每天早上打开先看的东西。

**理由（动线「每天早上先看什么」）**：
1. comps 需要**整屏宽度**放 6 列表格，bar 行内塞不下、窄屏还会被 `display:none`——物理上不能寄生在登记表。
2. 高级分析是「结构判断」的深读区，藏在一次点击后合理；但 comps 是**高频决策入口**，不能和迁移图并列共处一个二级页、被迁移图抢焦点。给它独立画布 + 独立面包屑，语义最干净。
3. 保留 bar 登记表原职能（规模/单指标排名）不动，尊重现有三层 IA（登记表→公司→财年），comps 作为**横切视图**旁挂，不破坏下钻链。

**需拍板的点（升级到主会话/PM）**：是否把 `comps` 设为**默认落地页**（打开工具第一眼即是对比表）。
分析师说「这是我把它当主力的唯一硬原因」，倾向支持默认落地 comps；但改默认动线属需求优先级范畴，我只给建议、不擅自定。本方案先按「首页顶部显眼入口、一次点击可达」交付，默认落地页留 PM 拍。

**导航集成**：
- `nav.svelte.js` 加 `goComps()`（对齐 `goAnalysis`：清 companyId/fy/periodId，`view='comps'`，`scrollTop()`）。
- `App.svelte` 的 `views` 映射加 `comps: Comps`。
- `Crumbs.svelte` 加一支：`if (nav.view === 'comps') arr.push({ label: '估值横截面', go: null })`。

---

## 3. 裁决二：列 → 6 列（4 估值核心 + 公司 + 环节），不塞满

| # | 列 | 类型 | 对齐 | 说明 |
|---|---|---|---|---|
| 1 | **公司** | 文本 | 左 | logo + 中文名 + 短名；窄屏 sticky 冻结列 |
| 2 | **环节** | 标签 | 左 | `STAGE_LABEL` 彩色 tag（承载「同环节」语境、可扫链条）|
| 3 | **Trailing PE** | 倍数 | 右 | `Selectors.pe`，Fmt.mult |
| 4 | **前瞻 PE** | 倍数 | 右 | `Selectors.forwardPE`，Fmt.mult；表头带 `NTM·一致预期` 副签，蓝 `--ai` 系区隔 |
| 5 | **EV/Sales** | 倍数 | 右 | `Selectors.evSales`，Fmt.mult |
| 6 | **FCF yield** | 百分比 | 右 | `Selectors.fcfYield`，Fmt.pct |

**为何不加 PS / 市值 / 更多列**：
- 分析师明确点名四倍数、且强调「桌面一屏」。四个数字列在 1280 下宽松、390 下靠横滚兜住即可；加第五个数字列会挤压、违背「别塞满」。
- **PS 作为可选列（P2）**：EV/Sales 对云三巨头（Alphabet/MS/Amazon）恒空，PS 在这几家有值、可作补看。故在表头右侧留一个「+ PS」轻量开关（默认关），点开临时插入 PS 列。**默认视图不含 PS**，保持四核心列的一屏纯净。
- 市值列不加（分析师没要，且会诱导用绝对市值排序，偏离估值对比主题）。

**前瞻 PE 的视觉特权**：它是分析师的头号诉求，也是覆盖最差（8/14）的一列——给它**表头蓝色底 + `NTM·一致预期` 副签**，既呼应公司页 `.fwd-pe` 的蓝色语言，又提示「口径是 consensus，非官方 trailing」。默认排序也锚定它（见裁决三）。

**同环节中位数/相对位（stageValuationRel）要不要进表**：
- **不进主表默认视图**（会与「按原始值排序」打架、增加噪音，违背分析师要的「先给我并列的裸倍数、任列排序」）。
- 作为 **P1 可选密度**：表头右侧「同环节相对位」开关（默认关）。开启后，每个数值单元格前加一个**小三角/圆点角标**（绿=同环节偏便宜、灰=居中、红=偏贵，方向按 `lowerCheaper` 分流），中位数走 `title` 悬浮（`同环节 3 家 · 中位 76.3×`）。角标是纯呈现、**不参与排序**、样本不足（<3）不显。数据由 `cell.rel` 已备好（见契约），组件零算术。

---

## 4. 裁决三：排序交互

- **任一数值列（3-6）表头可点排序**：点击在「降序 → 升序 → 降序…」间切换（每列独立记忆无必要，简单二态循环）。公司/环节两列默认可按名/按 `STAGE_ORDER` 排（P2，非核心）。
- **默认排序：前瞻 PE 升序（最便宜在最上）**。理由：分析师头号诉求是「一屏看前瞻倍数」，升序把「前瞻最便宜」的可行动标的顶到眼前，直接服务「拍板前」的动作。
  - **需确认点**：默认列/方向（前瞻 PE 升序 vs trailing PE 升序 vs 环节分组）交分析师一句话确认——这是口味不是对错。本方案锚定「前瞻 PE 升序」。
- **`—`（null）恒沉底**：无论升/降，缺值/na 行永远排在有值行之后（升序时不让 `—` 冒到「最便宜」顶端误导，降序时不让 `—` 挤掉真实高值）。排序比较器只读 `cell.sortKey`：`sortKey==null` 一律视为「排最后」。
- **distorted 参与排序**：Tencent PE 13.8×、SoftBank ps/evSales 有真实数字，`sortKey` 就是其值，正常参排，只是单元格带警示角标——分析师看得到数字也看得到「别当真」。
- **当前排序列高亮**：表头 `aria-sort="ascending|descending"`，视觉加下划/主色 + 升降箭头 `▲/▼`；其余列表头显示中性可点提示 `⇅`。
- **排序是 UI 状态、非财务算术**：组件持 `let sortCol=$state('forwardPE'); let sortDir=$state('asc')`，从 `compsTable().defaultSort` 初始化。排序数组 = `rows.slice().sort(比较 sortKey)`，属允许的「取值/排序」而非派生计算。

---

## 5. 裁决四：诚实呈现（项目命门）

三种「非正常」单元格，视觉必须一眼分明，且都不参与「被当成便宜/贵」的误读：

| 状态 `cell.state` | 触发 | 单元格显示 | 排序键 | 例 |
|---|---|---|---|---|
| `ok` | 有值、caveat=ok | `38.6×`（`.num`，常规） | = 值 | 多数 |
| `distorted` | caveat=distorted，值仍出 | `13.8×` + **⚠ 角标**（`.k-flag.distort` 系橙色），`title`=失真因由 | = 值（参排） | Tencent PE、SoftBank ps/evSales |
| `na` | caveat=na，值被强制 null | `—`（muted）+ 微标 **不适用**（`.k-flag.na`），`title`=为何不适用 | null（沉底） | SoftBank PE/前瞻PE/FCF yield |
| `blank` | caveat=ok 但 selector 返回 null（缺分母/缺输入） | `—`（muted）+ 微标 **待补**，`title`=缺什么 | null（沉底） | 前瞻PE：Samsung/Micron/SK/Arm/Tencent；EV/Sales：Alphabet/MS/Amazon |

**关键区分**：`na`（结构上不适用，如软银投资控股无经营 PE）vs `blank`（数据待补，补录后会自动点亮，如缺 consensus EPS / 缺 net_debt）——两者都显 `—` 但**微标文案不同**（不适用 / 待补），`title` 给出人话因由。这守住「诚实留空 ≠ 一律沉默」：告诉分析师「这格空是因为不该有」还是「空是因为还没录、别等」。

**缺前瞻 PE 的 6 家怎么显示**：前瞻 PE 列里，Samsung/Micron/SK/Arm/Tencent 显 `—` + `待补`（`title`：待补一致预期 EPS `consensus_eps_value`）；SoftBank 显 `—` + `不适用`（复用 pe=na）。默认前瞻 PE 升序时这 6 家全部沉底，8 家有值的在上方并列——正是分析师要的「一屏看前瞻倍数」。

**表头覆盖度提示**：每个数值列表头下方加一行极小的覆盖计数 `8/14 有值`（`.col-cover`，`--ink-faint`），让分析师一眼知道这列的稀疏度、不误判「怎么这么多空」。数据由 `column.covered` 备好。

**表底一条共享口径注**（复用 `ValuationCard` 的 `caveat-note` 折叠范式）：`<details>` 收纳「为何部分格留空/降级」的完整说明（口径错位：价格截至快照日、分母用最新实际财年；na/distorted/待补 各是什么）。不在每格复制长文，收敛为一条可展开注。

---

## 6. 裁决五：`Selectors.compsTable()` 输出契约（零组件算术）

组件**只做取值 + 排序 + 渲染**；一切值、格式类型、状态、caveat 因由、排序键、同环节相对位由 selector 一次备好。

```js
// data-module.js · Selectors 新增（纯派生，复用现有 pe/forwardPE/evSales/fcfYield/
// valuationCaveat/stageValuationRel/stageOf；零新增数据、零跨币相乘）
Selectors.compsTable() -> {
  columns: [
    { key:'name',       label:'公司',      kind:'text', sortable:false },
    { key:'stage',      label:'环节',      kind:'stage',sortable:true  },  // 按 STAGE_ORDER
    { key:'trailingPE', label:'Trailing PE', kind:'mult', sortable:true, covered:13, accent:false },
    { key:'forwardPE',  label:'前瞻 PE',   kind:'mult', sortable:true, covered:8,  accent:true,  sub:'NTM · 一致预期' },
    { key:'evSales',    label:'EV/Sales',  kind:'mult', sortable:true, covered:11, accent:false },
    { key:'fcfYield',   label:'FCF yield', kind:'pct',  sortable:true, covered:13, accent:false },
    // 可选列（+PS 开关点开时才在 columns 里出现，或恒在此由组件按开关过滤）：
    // { key:'ps', label:'PS', kind:'mult', sortable:true, covered:13, optional:true }
  ],
  rows: [
    {
      id:'nvidia', name:'NVIDIA 英伟达', shortName:'NVIDIA',
      logo_text:'nv', logo_class:'…',
      stage: { key:'design', label:'设计', color:'var(--stg-design)', sortKey:0 /* STAGE_ORDER 索引 */ },
      cells: {
        trailingPE: { value:38.6, kind:'mult', state:'ok',       sortKey:38.6, note:'', rel:{…} },
        forwardPE:  { value:21.3, kind:'mult', state:'ok',       sortKey:21.3, note:'', rel:{…} },
        evSales:    { value:21.2, kind:'mult', state:'ok',       sortKey:21.2, note:'', rel:{…} },
        fcfYield:   { value:0.021,kind:'pct',  state:'ok',       sortKey:0.021,note:'', rel:{…} }
      }
    },
    // …14 行
    // 例：SoftBank forwardPE → { value:null, kind:'mult', state:'na',
    //        sortKey:null, note:'投资控股，净利含投资公允价值损益，无经营 PE 含义', rel:{insufficient:true} }
    // 例：Samsung forwardPE → { value:null, kind:'mult', state:'blank',
    //        sortKey:null, note:'待补一致预期 EPS（consensus_eps_value）', rel:{…} }
    // 例：Tencent trailingPE → { value:13.8, kind:'mult', state:'distorted',
    //        sortKey:13.8, note:'净利含投资公允价值损益，非经营盈利', rel:{…} }
    // 例：Amazon evSales → { value:null, kind:'mult', state:'blank',
    //        sortKey:null, note:'缺净负债（net_debt）→ EV 无法计算，诚实留空', rel:{…} }
  ],
  defaultSort: { col:'forwardPE', dir:'asc' },
  caveatNote: '口径错位：价格截至快照日，倍数分母用各公司最新实际财年业绩…（表底共享注全文）'
}
```

**契约要点（工程师照做）**：
1. **`cell.state ∈ {ok, distorted, na, blank}`** 唯一驱动视觉分支。判定规则：
   - `valuationCaveat(c,caveatKey)==='na'` → `na`（value 必为 null）；
   - `==='distorted'` → `distorted`（value 非空则出值；理论上为空则退 `blank`）；
   - 否则 selector 值非 null → `ok`；值为 null → `blank`。
   （caveatKey 映射：trailingPE/forwardPE→`pe`，evSales→`ev_sales`，fcfYield→`fcf_yield`；前瞻 PE 复用 pe 的 caveat，与现有 `forwardPE` selector 一致。）
2. **`cell.sortKey`**：`(state==='ok' || state==='distorted') ? value : null`。组件比较器：两者皆 null 判 0；单侧 null 恒排最后（与升降无关）；否则按 dir 比 value。**组件不碰 value 做任何算术**，只比 sortKey。
3. **`cell.note`**：state 非 ok 时的一句人话因由（selector 侧文案，复用 `ValuationCard` 的 `SHORT_REASON` 词典 + 「待补/缺 X」模板），组件放进 `title`。
4. **`cell.rel`**：直接 `= Selectors.stageValuationRel(c, key)` 的返回（`{relative, lowerCheaper, cohortN, median, insufficient}`），供「同环节相对位」开关的角标 + 中位悬浮用，组件不再逐格调 selector。
5. **`kind`** 决定组件用 `Fmt.mult` 还是 `Fmt.pct`；组件：`state∈{ok,distorted} ? Fmt[kind==='pct'?'pct':'mult'](value) : '—'`。格式化留在 Fmt，selector 不返回已格式化字符串。
6. **`column.covered`** = 该列 state∈{ok,distorted} 的行数，供表头覆盖度提示。
7. `stage.sortKey` = 该 stage 在 `STAGE_ORDER` 的索引，供按环节排序。
8. 全程 null-safe、零跨币相乘（复用既有 selector 已保证）；**算不存**，无新增数据字段。

排序本身（`sortCol`/`sortDir` 状态、`.sort()`、`+PS`/相对位开关）＝UI 状态，允许在组件。

---

## 7. 布局线框（桌面 1280）

```
公司对比 / 估值横截面                                    ← 面包屑

估值横截面对比                                            ← h1.title
14 家 AI 价值链公司的 trailing/前瞻倍数并列，任一列点表头排序。   ← p.lead
口径：价格截至市场快照日，分母用各公司最新实际财年业绩（两时点不同属正常）。

[ 同环节相对位 ▢ ]   [ + PS 列 ▢ ]                       ← 右上密度开关（P1/P2，默认关）

┌───────────────┬──────┬───────────┬───────────┬──────────┬───────────┐
│ 公司          │ 环节 │Trailing PE│ 前瞻 PE ▲ │ EV/Sales │ FCF yield │  ← thead，前瞻PE蓝底+▲(当前升序)
│               │      │  13/14 有值│8/14·NTM一致│ 11/14 有值│ 13/14 有值│  ← .col-cover 覆盖度
├───────────────┼──────┼───────────┼───────────┼──────────┼───────────┤
│ 🟩 Oracle 甲骨文│ 云  │    23.6×  │   17.6×   │   7.5×   │  -5.8%    │  ← 前瞻最便宜在上
│ 🟦 NVIDIA     │ 设计 │    38.6×  │   21.3×   │   21.2×  │   2.1%    │
│ 🟦 Microsoft  │ 云  │    28.3×  │   23.1×   │    —待补 │   2.5%    │  ← evSales 缺→待补
│ …             │      │           │           │          │           │
│ 🟪 SoftBank   │ 投资 │  — 不适用 │  — 不适用 │ 6.8× ⚠  │  — 不适用 │  ← na×3 + distorted
│ 🟥 Tencent    │ 应用 │  13.8× ⚠ │  — 待补   │   4.6×   │   5.1%    │  ← distorted + 待补
│ 🟧 Micron     │ 存储 │   124.1× │  — 待补   │   28.5×  │   0.4%    │
│ 🟦 Arm        │ 设计 │   376.1× │  — 待补   │   68.4×  │   0.3%    │
└───────────────┴──────┴───────────┴───────────┴──────────┴───────────┘
   ▸ 为何部分格留空或降级？（口径说明 ⌄）                    ← <details> 表底共享注
```

数字列右对齐、`--mono`、`.num`；`—` 用 `--ink-faint`；⚠/不适用/待补微标 8-9px。斑马纹或行 hover 高亮辅助横向读行。

---

## 8. 裁决六：移动端 390px 方案

6 列真表在 390 塞不下，**不做卡片化**（卡片化破坏「并列排序」这一核心诉求）。降级为：

1. **横向滚动表 + 冻结公司列**：`.comps-scroll { overflow-x:auto }`，公司列 `position:sticky; left:0`（带右侧阴影提示可滚）。环节标签在窄屏可收成小色点或并进公司列下方，让 4 个数字列尽量露出（一屏能看到公司 + 2-3 个数字列，滑动看其余）。
2. **排序控件上移为独立条**（窄屏点小表头难）：表格上方加一行 `.sort-ctl`——一排 chip（Trailing PE / 前瞻 PE / EV/Sales / FCF yield）选排序列 + 一个 `▲升/▼降` 切换钮。桌面仍走表头点击；窄屏两者并存不冲突（同一 `sortCol/sortDir` 状态）。
3. **密度开关**（相对位/+PS）在窄屏折叠进一个「⋯ 显示选项」，避免占顶部。
4. 覆盖度 `8/14` 在窄屏移到表头单元格内小字，或并入排序 chip 的副标。

390 验收：能看到公司冻结列 + 至少 2 个数字列，横滑可达全部 4 列，用顶部 chip 完成排序，`—`/⚠/不适用 微标清晰。

---

## 9. 视觉规格（到类名，工程师照做）

新组件 `web/src/components/Comps.svelte`；样式加进 `web/src/app.css`（复用现有 token，不新造花哨样式）。

- 容器：`.comps-scroll{ overflow-x:auto; -webkit-overflow-scrolling:touch }` 包 `<table class="comps-table">`（**用语义 `<table>`**：th `scope="col"`、`aria-sort`，屏幕阅读器/键盘白拿，满足 a11y 维度）。
- 表头：`<th class="ch" aria-sort=…>` 内放 `<button class="ch-btn">` 承载点击排序（键盘可达）。当前列 `.ch.sorted`（主色下划 + `▲/▼`）；他列 `.ch-btn` 尾随中性 `⇅`（`--ink-faint`）。
  - 前瞻 PE 列表头 `.ch.accent`：浅蓝底（`--ai-soft`）+ 副签 `<span class="ch-sub">NTM · 一致预期</span>`，呼应 `ValuationCard` 的 `.fwd-tag`。
  - 覆盖度：`<span class="col-cover">8/14 有值</span>`（10px，`--ink-faint`）。
- 单元格数值：`<td class="cv num">`，右对齐，`--mono`。
  - `ok`：常规 `--ink`。
  - `distorted`：`<span class="cv-flag distort">⚠</span>`（复用 `.k-flag.distort` 的橙 `--est` 语义色），`title=note`。
  - `na`：`<span class="cv-dash muted">—</span><span class="cv-flag na">不适用</span>`（复用 `.k-flag.na`），`title=note`。
  - `blank`：`<span class="cv-dash muted">—</span><span class="cv-flag todo">待补</span>`（中性灰系，与 na 区分），`title=note`。
- 公司列 `.cc-name`：mini logo（复用 `.logo` 缩小档 26-30px）+ 名 + 短名；`position:sticky;left:0;background:var(--card);z-index:1`。整行/公司名可点跳 `nav.goCompany(id)`（顺手给下钻入口，非核心但零成本）。
- 环节列：复用彩色 stage tag 样式（参照 `.segtag`/迁移图 `.sw` 的 `STAGE_COLOR`）。
- 相对位角标（开关开时）：数值前 `<span class="cv-rel low|mid|high">`（小三角/圆点），色按 cheap/expensive；`title` 含 `同环节 N 家 · 中位 X`。
- 行 hover：`tbody tr:hover{ background:var(--card-2) }`；可选斑马 `tr:nth-child(even)`。
- 表底：复用 `ValuationCard` 的 `.caveat-note`（`<details><summary>为何部分格留空或降级？<span class="cn-hint">口径说明 ⌄</span></summary><p>{caveatNote}</p></details>`）。
- 入口卡：改造 `Home.svelte` 的 `.analysis-entry` 为双卡容器 `.entry-grid`，估值横截面卡加 `.primary`（主色描边 + ★）。

**文案**（对投资者友好、可靠度标签被解释）：
- h1：`估值横截面对比`；lead：`14 家 AI 价值链公司的 trailing / 前瞻倍数并列，任一列点表头即可排序。`
- 口径行：`价格截至市场快照日，倍数分母用各公司最新实际财年业绩（两者时点不同，属正常）。`
- 前瞻 PE 副签：`NTM · 一致预期`（+ `title`：来源 consensus，非官方 trailing）。
- `不适用` title 例（SoftBank）：`投资控股公司，净利含投资公允价值损益，PE 无经营含义 → 诚实留空。`
- `待补` title 例（前瞻 PE）：`待补一致预期 EPS（consensus_eps_value），补录后自动点亮。`
- `待补` title 例（EV/Sales 云三家）：`缺净负债（net_debt）→ EV 无法计算，诚实留空。`
- ⚠ title 例（Tencent PE）：`净利含投资公允价值损益，非经营盈利，倍数失真仅供参考。`

---

## 10. 验收点（Definition of Done 自检）

- [ ] 顶层 `comps` 视图存在，首页有显眼入口一键可达，面包屑 `公司对比 / 估值横截面` 正确。
- [ ] 一屏并列 14 行 × 4 估值列（+公司+环节），1280 无横滚全见。
- [ ] 4 个数值列表头均可点排序，升/降切换，`aria-sort` 正确，当前列高亮 + 箭头。
- [ ] 默认前瞻 PE 升序：8 家有值升序在上、6 家 `—` 沉底；切降序 `—` 仍沉底。
- [ ] 诚实三态视觉分明：SoftBank 三格「不适用」、Tencent PE 与 SoftBank ps/evSales 带 ⚠ 且参排、缺前瞻 PE 6 家与缺 EV/Sales 3 家显「待补」且 title 说明缺什么。
- [ ] 表头覆盖度 `8/14` 等显示正确；表底口径说明可展开。
- [ ] `Selectors.compsTable()` 备齐行/列/state/sortKey/note/rel/defaultSort；**组件内无任何财务算术**（grep 组件无 `/`、`*` 于业务值），只有排序比较与 Fmt 渲染。
- [ ] 390 窄屏：公司列冻结、横滑可达全部列、顶部排序 chip 可用、微标清晰。
- [ ] 无估算/填 0（守项目命门）；`—` 语义按 na/待补 分文案。
- [ ] 键盘可 Tab 到每个排序表头并回车触发；⚠/不适用/待补不只靠颜色（有文字微标 + title）。

---

## 11. 需上层拍板/确认的点

1. **默认落地页**是否设为 `comps`（分析师「唯一硬原因」倾向支持；属动线/需求优先级，PM 定）。本方案先交「首页显眼入口、一次点击可达」。
2. **默认排序列/方向**：本方案锚定「前瞻 PE 升序」，请分析师一句话确认（vs trailing PE 升序 / 环节分组）——口味题。
3. **PS 列**：默认关、可选开关。若分析师认为 EV/Sales 云三家常空、宁可默认就带 PS，可改默认开——请确认。
4. **同环节相对位角标**：本方案默认关（保持首读裸倍数纯净），P1 增量。若分析师认为「贵/便宜」语境应默认可见，可改默认开。
