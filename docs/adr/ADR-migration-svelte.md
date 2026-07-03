# ADR: 视图层迁移到 Svelte 5 + Vite（保留单文件 app.html）

- 状态：Done（Svelte 5 迁移已完成并切换：三视图 parity 通过，根 `app.html` 改由 `cd web && bun run build` 产出，`build.py` 与 `app.template.html` 已退休）
- 日期：2026-07-01
- 决策者：架构师
- 落地执行：engineer（本文精确到文件名 / 脚本命令 / 接口骨架，可直接分工）

> **补记（2026-07-01）· 包管理器 = bun。** 用户选定 bun（新项目，取其最快安装 + 内置
> JS/TS 运行器 + 文本 lockfile `bun.lock`）。Vite/Svelte/singlefile 管线不变，bun 仅作包管理
> 与脚本运行器（`bun install` / `bun run dev|build`）；`test:data` 用 `bun` 跑（CJS 兼容已验），
> `validate` 仍是 `python3`。实测 `bun run build` 会执行 `prebuild` 生命周期钩子，闸门有效。
> **本文下述所有 `npm run X` 一律等价读作 `bun run X`。**

---

## 一句话架构判断

**皇冠明珠 `data-module.js`（Store + Selectors，纯函数、无 DOM、算不存）原样保留、升格为 shared ESM，成为唯一的业务真相边界；Svelte 只接管"呈现 + 导航"这一层——把 18 个 `render*` 字符串函数换成组件，把手写 `state` 换成轻量 `$state`/`$derived` runes，用 `$derived` 从结构上钉死"派生算不存"、用"组件只 import Selectors、禁止业务算术"钉死"视图无计算"。数据管线（companies.json / schema.json / validate.py / tools）完全正交，不动；validate.py 升格为 `vite build` 的前置闸门。**

迁移是**替换视图层的物理载体**，不是重写业务逻辑。任何在 Svelte 组件里重新实现 Selectors 里已有的算术，都是架构违规。

---

## 背景

现状（已读代码确认）：

- **`data-module.js`（26KB）**：`Store`（加载 + 访问）+ `Selectors`（≈40 个纯函数派生：netMargin/revYoY/reconcile/incomeFlow/aiShare/profitPoolAI/profitPoolMigration/profitPoolTTM/ttmNetIncome/pe/ps/evSales/fcfYield…）。无 DOM、无格式化。双模：浏览器读 `<script id="dataset">` 或 `fetch("companies.json")`；Node 走 `module.exports`（CJS）。`STAGE_ORDER/LABEL/COLOR` 由 `_refreshStages(meta)` 就地派生。
- **`app.template.html`（85KB）**：20KB CSS + 50KB JS（18 个函数：`show/renderCrumbs/goHome/renderHome/renderMigration/goCompany/renderCompany/renderCash/renderValuation/renderEvVsGrowth/renderTrend/goDetail/renderDetail/actualView/renderIncomeSankey/forecastView/sourcesBlock/init`）+ 4KB HTML 骨架。呈现方式：全部 `el.innerHTML = \`...\`` 字符串模板 + `Fmt`（bn/pct/mult/yoy/segLabel）格式化 + `Safe`（text/attr/cls/url）转义。图表是**手写 SVG 字符串**（trend / migration / sankey / evVsGrowth），无图表库。路由是手写 `state={view,companyId,fy,homeMetric}` + `show()` 切 `display`，**无 URL**。
- **`build.py`**：把 `/*__DATA_MODULE__*/` 和 `__DATASET_JSON__` 两个占位符替换进模板产出 `app.html`。有 `--check` 模式。
- **`validate.py` / `schema.json` / `companies.json` / `test-data-module.js`（消费 CJS `require`）/ `tools/`**：数据/取数/校验管线，与视图正交。

约束：产出仍须是**双击可打开的单文件 `app.html`**（0 外部引用），供离线分发。

---

## 决策

### 决策 1：目录布局 —— 新建 `web/`，源码同层，data-module 提升为 shared

在仓库根新增 `web/`，视图源码全部落在 `web/src/`。`data-module.js` **物理保留在仓库根**（数据管线也要 import 它），Vite 通过相对路径 `../data-module.js` 消费——**不复制、不搬家**，保持唯一副本。

```
ai-profit-pool/
├─ data-module.js          # 皇冠明珠，原样保留在根（决策 2 讨论 ESM 化）
├─ companies.json          # 唯一真相源，不动
├─ schema.json             # 契约，不动
├─ validate.py             # 升格为构建闸门（决策 3）
├─ test-data-module.js     # 保留（决策 2 讨论其 import 方式）
├─ tools/                  # 取数，不动
├─ app.html                # 迁移期沿用 build.py 产出；退休后由 vite 产出（决策 6/7）
├─ app.template.html       # 迁移期保留，parity 达标后退休（决策 7）
├─ build.py                # 同上
├─ docs/adr/ADR-migration-svelte.md
└─ web/
   ├─ package.json         # svelte 5 / vite / vite-plugin-singlefile / @sveltejs/vite-plugin-svelte
   ├─ vite.config.js       # singlefile 配置，输出到根 app.html（决策 6）
   ├─ index.html           # Vite 入口，含 <div id="app"> 与内联 dataset（决策 6）
   └─ src/
      ├─ main.js           # 挂载 App；调用 Store.load()（决策 2）
      ├─ App.svelte        # 路由壳 + 面包屑（原 show/renderCrumbs/init）
      ├─ lib/
      │  ├─ data.js        # re-export Store/Selectors/STAGE_* from '../../data-module.js'（唯一入口）
      │  ├─ fmt.js         # Fmt（bn/pct/mult/yoy/segLabel）—— 从模板原样搬来
      │  ├─ safe.js        # Safe（text/attr/cls/url）—— Svelte 自动转义后多数场景可退役，见决策 5
      │  ├─ nav.js         # 轻量路由 store（$state），原 state 对象（决策 4）
      │  └─ constants.js   # HOME_METRIC_LABEL/FMT/LOWER_CHEAPER 等纯呈现常量
      ├─ components/
      │  ├─ Home.svelte            # renderHome + renderMigration 宿主
      │  ├─ Company.svelte         # renderCompany + renderCash/Valuation/EvVsGrowth/Trend 宿主
      │  ├─ Detail.svelte          # renderDetail + actualView/forecastView 宿主
      │  ├─ Crumbs.svelte          # renderCrumbs
      │  ├─ SourcesBlock.svelte    # sourcesBlock（provenance 呈现，决策 5-不变量2）
      │  ├─ CompanyRow.svelte      # 登记表单行（renderHome 内联的 crow）
      │  ├─ ValuationCard.svelte   # renderValuation
      │  └─ Reconcile.svelte       # 对账呈现（不变量 4）
      └─ charts/
         ├─ Trend.svelte          # renderTrend（SVG）
         ├─ Migration.svelte      # renderMigration（SVG 堆叠迁移图）
         ├─ Sankey.svelte         # renderIncomeSankey（SVG 桑基）
         └─ EvVsGrowth.svelte     # renderEvVsGrowth（SVG 散点）
```

CSS：`app.template.html` 的 20KB `<style>`（含 `:root` 全部 CSS 变量，尤其 `--stg-*` 环节色、`--ai`/`--ok`/`--est` 语义色）**整块搬到 `web/src/app.css`，由 `main.js` 全局 import**。理由：现有 CSS 依赖全局类名 + CSS 变量级联，`STAGE_COLOR` 派生出的是 `var(--stg-design)` 这类**引用**（见 test 第 502 行），不是 hex；拆成组件 `<style scoped>` 会打断变量级联、且要重写 `Safe.cls` 生成的动态类名逻辑，风险大收益小。全局 CSS 是此项目的正确选择。

---

### 决策 2：`data-module.js` 复用策略 —— 双导出（CJS + ESM 命名导出），一份文件；数据走 Vite 原生 import

**结论：把 `data-module.js` 改成"CJS 与 ESM 双兼容"的单文件，不建适配层、不维护两份。** 具体做法：文件末尾保留现有 CJS 导出，并**追加** ESM 命名导出。

现状末行（保留）：
```js
if (typeof module !== "undefined" && module.exports) module.exports = { Store, Selectors, STAGE_OF_FALLBACK, STAGE_ORDER, STAGE_LABEL, STAGE_COLOR, stageOf, _refreshStages };
```

两个可选实现，给结论：

- **方案 A（推荐）：文件保持 `.js`，末尾追加 `export { ... }`。** 但 `export` 语句在被 `require()`（CJS）解析时会语法报错——因此**不能**在同一 `.js` 里裸写 `export`。故采用下述具体形态：
- **方案 B（最终采纳）：`data-module.js` 保持纯 CJS 不动；在 `web/src/lib/data.js` 建一个"ESM 适配壳"。** 通过 Vite 的 `import x from '../../data-module.js'`（Vite 用 esbuild 能把 CJS 的 `module.exports` 转成默认导入），再解构成命名导出给组件用。

> 权衡：方案 A 需要把 `data-module.js` 改成 `.mjs` 或加 `"type":"module"`，会连累 `test-data-module.js`（`require`）与 `validate.py`（若它 exec 该模块）——牵动数据管线，违反"数据管线正交"。方案 B **零改动 `data-module.js`、零改动 `test-data-module.js`**，把 CJS→ESM 的桥接完全关在 `web/` 内部，是最小破坏。**采纳方案 B。**

`web/src/lib/data.js`（适配壳，engineer 落地骨架）：
```js
// 唯一允许 import 业务模块的地方。组件一律从这里拿 Store/Selectors，
// 不允许组件直接 import '../../data-module.js'（用 ESLint no-restricted-imports 钉死，见决策 5）。
import mod from '../../data-module.js';   // Vite/esbuild 把 CJS module.exports 映射为 default
export const { Store, Selectors, STAGE_OF_FALLBACK, STAGE_ORDER, STAGE_LABEL, STAGE_COLOR, stageOf, _refreshStages } = mod;
```
> 若实测 esbuild 对该 CJS 的 default interop 出现命名导出直取问题（Vite 有时同时暴露命名导出），engineer 可改写为 `import * as mod` 兜底；语义不变，仍是"一份 data-module + 一层壳"。

`test-data-module.js`：**完全不动**，继续 `require("./data-module.js")` 跑 Node 断言。它是 Selectors 的回归护栏，迁移不得削弱它。

**数据如何进 app：结论用 Vite 原生 import，不用运行时 fetch。**

- `Store.load()` 现有逻辑：先找 `document.getElementById("dataset")`，没有才 `fetch("companies.json")`。单文件场景**必须走内联 dataset 分支**（fetch 在 `file://` 下会被 CORS/协议拦截，正是当初内联的原因）。
- Vite 入口 `web/index.html` 里保留 `<script type="application/json" id="dataset">` 节点，**构建时由 vite-plugin-singlefile 之前的一步把 `companies.json` 内联进去**（决策 6 给出机制）。这样 `Store.load()` 的 dataset 分支零改动即命中。
- 为什么不在 `main.js` 里 `import data from '../../companies.json'` 直接喂给 `Store._data`？可以，且更"Vite 原生"。**给结论：两条腿都要，但以内联 `<script id="dataset">` 为准**——因为 `Store.load()` 的契约（读 dataset 节点）已被 `data-module.js` 和其未来 HTTP 部署共用，破坏它会污染业务模块。`main.js` 只负责 `await Store.load()`，不旁路塞 `_data`。若 engineer 偏好 `import data`，则须在 `main.js` 里 `Store._data = data; _refreshStages(data.meta)` 并**同时保证** dataset 节点仍存在以兼容 `load()`——多一处真相源，不推荐。**采纳：内联 dataset 节点 + `await Store.load()`。**

---

### 决策 3：validate.py 作为构建闸门 —— `prebuild` 钩子，0 ERROR 才继续

`web/package.json` scripts：
```json
{
  "scripts": {
    "validate": "python3 ../validate.py ../companies.json ../schema.json",
    "test:data": "bun ../test-data-module.js",
    "prebuild": "bun run validate && bun run test:data",
    "build": "vite build",
    "dev": "vite",
    "preview": "vite preview"
  }
}
```
- `npm run build` 前 npm 自动跑 `prebuild`：先 `validate.py`（数据契约），再 `test-data-module.js`（Selectors 回归）。任一非 0 退出码 → 构建中止。**脏数据或坏派生逻辑永远进不了 app.html。**
- 前提：`validate.py` 以非 0 退出码表示存在 ERROR（engineer 落地时须确认；现状它对 ERROR 是否 `sys.exit(1)` 需核对，如不是则给 validate.py 加一行"有 ERROR 则 exit 1"，这是本 ADR 唯一允许触碰数据管线的点，且是加固不是改语义）。
- CI 同理调 `npm run build`（含 prebuild），与本地一致。
- 迁移期 `build.py` 仍在，其自身不跑 validate；发布路径以 `web` 的 `npm run build` 为准。

---

### 决策 4：组件树与路由 —— 保持轻量 state 机，**不引入路由库**，用 runes store 承载

现状是无 URL 的 `state` + `show()`。**结论：迁移期先做"功能对等"，用一个 `$state` 路由 store 替代 `state` 对象，不引第三方路由库。** 理由：当前只有 3 个视图 + 少量参数（companyId/fy/homeMetric），手写 `show()` 已够；引 svelte-routing/tinro 会为了 URL 而 URL，超出"功能对等"范围，属产品决策（可否分享深链）——不在本次架构迁移职责内，留作后续 ADR。

18 个 `render*` → 组件映射：

| 原函数 | 落点组件 | 说明 |
|---|---|---|
| `show` / `init` | `App.svelte` + `main.js` | `<svelte:component this={current}>` 按 `nav.view` 切换；`init` 的 `await Store.load()` 移到 `main.js` |
| `renderCrumbs` | `Crumbs.svelte` | 读 `nav`，点击调 `nav.goHome/goCompany` |
| `goHome` / `renderHome` | `Home.svelte` | 三卡 hero + 登记表 + 待补录，数据全来自 `Selectors.profitPoolAI/profitPoolMigration/homeMetric` |
| `renderMigration` | `charts/Migration.svelte` | SVG 堆叠迁移图（宿主 Home） |
| `goCompany` / `renderCompany` | `Company.svelte` | KPI + 年份表 |
| `renderCash` | `Company.svelte`（或子块） | FCF/capex 现金块 |
| `renderValuation` | `ValuationCard.svelte` | PE/PS/EV-Sales/FCF yield + caveat 三态警示 |
| `renderEvVsGrowth` | `charts/EvVsGrowth.svelte` | SVG 散点 |
| `renderTrend` | `charts/Trend.svelte` | SVG 折线；`onMount` + `ResizeObserver` 替代原 window resize 手动重画 |
| `goDetail` / `renderDetail` | `Detail.svelte` | 财年下钻壳 |
| `actualView` | `Detail.svelte` 内块 | 实际年（含 `hasSegmentProfit` 三态分流，不变量 4） |
| `renderIncomeSankey` | `charts/Sankey.svelte` | SVG 桑基（消费 `Selectors.incomeFlow`） |
| `forecastView` | `Detail.svelte` 内块 | 预测年 |
| `sourcesBlock` | `SourcesBlock.svelte` | provenance 呈现（不变量 2） |

`web/src/lib/nav.js`（路由 store 骨架）：
```js
// 轻量路由：等价于原 state 对象，用 Svelte 5 runes。无 URL（功能对等阶段）。
class Nav {
  view = $state('home');        // 'home' | 'company' | 'detail'
  companyId = $state(null);
  fy = $state(null);
  homeMetric = $state('revenue');
  goHome()          { this.companyId = null; this.fy = null; this.view = 'home'; window.scrollTo({top:0}); }
  goCompany(id)     { this.companyId = id; this.fy = null; this.view = 'company'; window.scrollTo({top:0}); }
  goDetail(id, fy)  { this.companyId = id; this.fy = fy;   this.view = 'detail'; window.scrollTo({top:0}); }
}
export const nav = new Nav();
```

`App.svelte`（壳骨架）：
```svelte
<script>
  import { nav } from './lib/nav.js';
  import Crumbs from './components/Crumbs.svelte';
  import Home from './components/Home.svelte';
  import Company from './components/Company.svelte';
  import Detail from './components/Detail.svelte';
  const views = { home: Home, company: Company, detail: Detail };
  const Current = $derived(views[nav.view]);   // 派生，不存
</script>
<Crumbs />
<Current />
```

图表组件复用现有 SVG 生成逻辑的方式（骨架，engineer 落地）：现有 SVG 是字符串拼接。**结论：优先用 Svelte 模板 `{#each}` 声明式渲染 SVG 元素**（`<rect>/<path>/<text>`），把原函数里的坐标/比例计算全部换成 `$derived` 出来的几何数据数组；`$derived` 的输入只能是 `Selectors.*` 的返回值。这样图表也自然满足"派生算不存"。仅当某图迁移成本过高，允许过渡期 `{@html svgString}`（svgString 来自纯函数），但列入 parity checklist 的技术债，后续替换。

---

### 决策 5：五大不变量 → Svelte 的结构性映射

| 不变量 | 现状怎么守 | Svelte 下怎么**结构性**守住 |
|---|---|---|
| **1. 派生值算不存** | Selectors 读时算，从不写回 companies.json；view 只读 | 组件里所有派生一律用 `$derived`／`$derived.by`，**输入是 `nav` 或 `Store` 的原始值，产出永不写回 `Store._data`**。`$derived` 是只读计算图，天然"读时算、不落库"。禁止 `$effect` 里把派生结果赋回任何 Store 字段（ESLint `no-restricted-syntax` 或 code review 钉）。`companies.json` 仍是唯一真相源，Selectors 仍是唯一派生处。 |
| **2. provenance 强制** | 每 actual 年 + 每 source 带 `url`+`data_status`；validate.py 把关 | 校验归属不变（validate.py，决策 3 已是构建闸门）。呈现集中在 `SourcesBlock.svelte`，`data_status` 渲成标签、`url` 经 `Safe.url` 白名单（只放行 http(s)）。**不编造**：source 缺失时组件渲染空/占位，绝不填默认 URL。 |
| **3. 留空也比填错好** | Selectors 全 null-safe，缺输入返回 null；Fmt.bn/pct 把 null 渲成 "—" | 组件**直接透传** Selectors 的 null，交给 `Fmt`（`v==null?"—"`）。组件模板里**禁止** `?? 0`、`|| 0`、`?? '估算'` 这类把 null 伪造成值的写法（review + lint 规则）。null 一路走到 Fmt 变成 "—"。 |
| **4. 平台对账** | `Selectors.reconcile(y)`：platform 强制 sum==revenue，division 不强制；`segmentKind`/`hasSegmentProfit` 三态分流 | 对账逻辑**不进组件**，`Reconcile.svelte` 只呈现 `Selectors.reconcile(y)` 的 `{ok, kind, diff, partition}`。三态下钻（真实利润表 / 待补录 / 结构性缺口）在 `Detail.svelte` 里靠 `{#if Selectors.hasSegmentProfit(y)}` 分支，判定仍在 Selectors。 |
| **5. 视图无计算** | Fmt 格式化、Safe 转义、Selectors 算业务，view 只拼串 | **组件唯一的业务数据来源是 `web/src/lib/data.js`（re-export Selectors/Store）。** 用 ESLint `no-restricted-imports` 禁止组件直接 import `../../data-module.js`、`../../companies.json`。**用 `no-restricted-syntax` 或人工 review 禁止组件内出现业务算术**（`/`、`*`、`-` 用于财务量，YoY/占比/倍数等）——一旦需要新指标，去 `data-module.js` 加 Selector，不在组件里算。格式化只准用 `Fmt`，转义靠 Svelte 内建 `{expr}` 自动转义（`Safe.text` 大幅退役），仅 `Safe.url`（URL 白名单）和动态 class 场景 `Safe.cls` 保留。 |

> 关键落点：**不变量 1 和 5 是这次迁移最容易被破坏的两条。** 它们的守护不能靠自觉，靠两个机器可查的约束：(a) 组件只能从 `lib/data.js` 拿业务，(b) 组件里不得出现财务算术。engineer 落地时把这两条写进 `web/.eslintrc`（`no-restricted-imports` 指向 `data-module.js`/`companies.json`；财务算术用 code review + 一条自定义 lint/CI grep 兜底）。

---

### 决策 6：单文件产出 —— vite-plugin-singlefile 输出到根 `app.html`，数据内联

`web/index.html`（Vite 入口骨架）：
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>AI 利润池 · 公司经营数据</title></head>
<body>
  <div id="app"></div>
  <!-- dataset 节点：构建期由 companies.json 内联；Store.load() 读它（决策 2） -->
  <script type="application/json" id="dataset"><!--__DATASET_JSON__--></script>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

`web/vite.config.js`（骨架）：
```js
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 构建期把 companies.json 内联进 index.html 的 dataset 占位符。
// 单一真相源仍是根 companies.json；这里只做注入，不改写。
function inlineDataset() {
  return {
    name: 'inline-dataset',
    transformIndexHtml(html) {
      const data = readFileSync(resolve(__dirname, '../companies.json'), 'utf-8').trim();
      return html.replace('<!--__DATASET_JSON__-->', data);
    },
  };
}

export default defineConfig({
  plugins: [svelte(), inlineDataset(), viteSingleFile()],
  build: {
    outDir: resolve(__dirname, '..'),   // 输出到仓库根
    emptyOutDir: false,                  // 关键：别清空根目录！
    rollupOptions: { output: { entryFileNames: 'app.[hash].js' } }, // 会被 singlefile 内联掉
  },
});
```

要点：
- `viteSingleFile()` 把 JS/CSS 全部内联进单个 HTML，产出 0 外部引用（已实测通过）。
- `outDir: '..'` + `emptyOutDir: false`：直接产出到根，覆盖旧 `app.html`。**`emptyOutDir:false` 必须**，否则 Vite 会清空整个仓库根——数据管线全毁。engineer 务必核对；建议先输出到 `web/dist/app.html` 再单独 copy 到根，避免 `outDir:'..'` 的误删风险（更稳，推荐这条：`build.outDir='dist'`，`package.json` build 后 `&& cp dist/app.html ../app.html`）。
- Vite 产物 `index.html` 默认名，若直接 outDir 到根会与入口无关（入口是 `web/index.html`）。用 `dist` + copy 方案时，产物是 `web/dist/index.html`，copy 为根 `app.html`。**采纳 dist+copy，规避 emptyOutDir 风险。**
- 谷歌字体 `<link>`：现状模板引外部字体。单文件离线场景该 link 会失效但不阻断（降级到系统字体）。**保留 link**（在线时更美，离线时优雅降级），不阻断"0 外部引用"目标——singlefile 管的是 JS/CSS/img 内联，外部字体 link 是可接受的软依赖。若产品要求纯离线一致渲染，另开 ADR 讨论字体内嵌（体积代价大）。

最终 build 命令：`cd web && npm run build`（prebuild 跑 validate + test → vite build → copy 到根 app.html）。

---

### 决策 7：增量切换策略 + 功能对等 checklist

**并行期（老 app.html 始终可用）：**
1. `web/` 全程独立开发，`npm run dev` 起 Vite 热更，不碰根 `app.html`。
2. 直到 parity checklist 全绿之前，**发布仍用 `python3 build.py`**（老链路）。`web` 的产物先输出到 `web/dist/`，人工比对，不覆盖根 `app.html`。
3. parity 全绿后，切换发布命令为 `cd web && npm run build`（覆盖根 `app.html`），**同一提交里** `git rm app.template.html build.py`，README 更新构建说明。此为 `build.py`/`app.template.html` 的退休时点。
4. `data-module.js`、`companies.json`、`schema.json`、`validate.py`、`test-data-module.js`、`tools/` **全程不退休、不搬家**。

**逐视图 parity 验收清单（每项都要人工对拍老 app.html 同屏核对）：**

Home（Home.svelte + Migration.svelte）：
- [ ] 三张 hero 卡：AI 利润池总额、利润最集中（龙头占比）、利润池同比——数字与老页**逐位一致**（同源 `profitPoolAI`/`profitPoolMigration`）。
- [ ] hero 总额 == 迁移图最新位置 total（口径自洽，老页断言过）。
- [ ] `poolNote`：n/N 家覆盖、basisCount（sourced/proxy）文案一致。
- [ ] 迁移图 SVG：环节堆叠顺序 == `STAGE_ORDER`、颜色 == `var(--stg-*)`、含最右 TTM 柱、负值（memory downcycle）不崩、hover/focus 高亮联动。
- [ ] 登记表：9 家排序随 homeMetric 切换；"越低越便宜"指标的 metric-hint 文案；bar 宽度；seg_profit 三态 tag；预测年 ≈ 提示。
- [ ] 待补录区（当前为空）渲染不崩；addHint 文案。
- [ ] homeMetric chip 切换（revenue/netIncome/netM/fcfMargin/capexInt/pe/ps/evSales/fcfYield）全部出正确值与 "—"。

Company（Company.svelte + Cash/Valuation/EvVsGrowth/Trend）：
- [ ] KPI 卡、年份表、ticker/region/sector badge、lead 文案、NVDA 特例 note。
- [ ] 现金块 FCF/capex（用 latestCashYear 回退逻辑，非 latestActual）。
- [ ] 估值卡 PE/PS/EV-Sales/FCF yield：caveat 三态（na 留空 / distorted 出值带警示 / ok 正常）——软银 pe/fcf_yield=na 空、ps distorted 出值；腾讯 pe distorted 出值。
- [ ] EvVsGrowth 散点：净现金 vs 净负债方向（NVDA EV<市值、AVGO EV>市值）。
- [ ] Trend 折线：营收/净利双线、resize 重画（改 ResizeObserver 后仍自适应）。
- [ ] 不存在的 companyId → 优雅"公司不存在"降级。

Detail（Detail.svelte + actual/forecast/Sankey/SourcesBlock）：
- [ ] `hasSegmentProfit` 三态：真实利润表（三星/博通/美光）/ 待补录 / 结构性缺口（台积电/ASML/软银）分流正确。
- [ ] 桑基图：incomeFlow 各节点（segments→revenue→gross/cogs→op/opex→net/taxOther），`has.*` 为 false 时优雅降级（缺 gross_margin 不画毛利段、缺 op_income 不画 opex/taxOther 段），taxOther 负值（net>op）方向正确不取绝对值。
- [ ] 对账块：platform ok/ division 不强制、diff 显示。
- [ ] forecastView 预测年呈现。
- [ ] SourcesBlock：每条 source 的 label、data_status 标签、url 经 Safe.url（非 http(s) → #）。

全局：
- [ ] 面包屑三级（公司对比 / 公司名 / 财年）点击回跳。
- [ ] 所有 null 渲染为 "—"（不变量 3 抽查：无 `0`/`估算` 伪值）。
- [ ] 单文件产出 0 外部引用（字体 link 除外，属软依赖）；双击 `file://` 打开可用（走 dataset 内联分支）。
- [ ] `node ../test-data-module.js` 绿（Selectors 未被动过）。
- [ ] `python3 ../validate.py` 0 ERROR。

---

## 理由

- **保住皇冠明珠**：Selectors 是本项目最大资产（40 个纯函数 + 54KB 回归测试）。迁移只换呈现载体，业务边界零位移，风险最小、收益（组件化可维护性、runes 响应式）最大。
- **不变量靠机制而非自觉**：决策 5 把"派生算不存/视图无计算"落成 `$derived` + `no-restricted-imports` + 禁财务算术三条机器可查约束，比模板时代（靠"view 只 innerHTML"的君子协定）更硬。
- **数据管线正交**：companies.json/schema.json/validate.py/tools/test-data-module.js 全程不动（validate.py 仅加固退出码），迁移不引入数据风险。
- **可回退**：并行期老链路（build.py）随时可发布，parity 全绿才退休——单向门变成可逆迁移。

## 影响（受影响的层 / 文件）

- **新增**：整个 `web/` 树（package.json / vite.config.js / index.html / src/**）、`docs/adr/ADR-migration-svelte.md`（本文）。
- **加固（唯一触碰数据管线处）**：`validate.py` 确认/补上"有 ERROR 则非 0 退出"，供 prebuild 闸门用。
- **不变**：`data-module.js`（CJS 导出原样，ESM 桥接在 web/src/lib/data.js）、`companies.json`、`schema.json`、`test-data-module.js`、`tools/`。
- **退休（parity 全绿后，同一提交）**：`app.template.html`、`build.py`；根 `app.html` 改由 vite 产出。
- **契约边界**：视图与数据的接口仍是 `Store` + `Selectors`（不变）；新增指标一律走 `data-module.js` 加 Selector，绝不在组件里算。

## 迁移 / 校验点（engineer 必核）

1. **`web/src/lib/data.js` 的 CJS→ESM interop**：`import mod from '../../data-module.js'` 能否拿到 `mod.Store/Selectors`。若 esbuild default-interop 异常，退 `import * as mod`。跑一个最小组件断言 `Selectors.pe` 存在。
2. **`Store.load()` 命中 dataset 分支**：单文件里 `document.getElementById("dataset")` 有内容 → 走 JSON.parse 分支，**不触发 fetch**。构建后 `file://` 双击验证。
3. **validate.py 退出码**：`python3 validate.py; echo $?` 在有 ERROR 时须为非 0，否则 prebuild 闸门形同虚设。
4. **`emptyOutDir` 风险**：绝不用 `outDir:'..'` + `emptyOutDir:true`。采纳 `dist` + copy 方案。
5. **`_refreshStages` 时机**：`Store.load()` 内部已调 `_refreshStages(meta)`；组件读 `STAGE_COLOR` 前须确保 `await Store.load()` 已完成（`main.js` 里 await 后再挂载 App，或 App 顶层 `{#await}`）。否则 `STAGE_COLOR` 为空。
6. **回归**：每完成一个视图组件，跑 `node ../test-data-module.js` 确认没顺手改到 data-module.js。
