# AI 利润池 · 解耦后的数据/视图架构

数据已从界面剥离。各层职责单一，存储技术可替换。

## 文件

| 文件 | 角色 | 说明 |
|---|---|---|
| `data/meta.json` + `data/companies/<id>.json` | **权威存储**（唯一真相源，一司一文件） | 只放原始、有来源的事实。**不存任何派生值**。批次只碰自己的分片，review 隔离。`meta.company_order` 是显式公司顺序。 |
| `companies.json` | ~~权威存储~~（已退役） | 现为 gitignore 的兼容产物；消费方一律经组装器读 `data/`。 |
| `schema.json` | **数据契约** | JSON Schema。存储、采集、视图都依赖它，不互相依赖。 |
| `validate.py` | **入库 QA 闸门** | schema 校验 + 平台合计对账 + provenance 检查。**支持目录输入**（`validate.py data schema.json`，内部组装）。出错 `exit 1`，可挡流水线。 |
| `tools/assemble.py` / `tools/assemble.cjs` | **组装器** | `data/` 分片 → 完整数据集（python 供 validate/merge，node 供测试）。零校验。 |
| `tools/merge.py` | **入库收尾** | 把采集产物按 id 合并进分片 → validate → build，失败回滚分片。 |
| `tools/diff_data.py` | **数据 diff** | 两状态的数据级对照报告（period 字段/分部/quote，FX 基准变化单列）。review 批次用。 |
| `data-module.js` | **数据访问层** | `Store`（加载）+ `Selectors`（派生：利润率/同比/对账/排序）。无 DOM、无格式化。 |
| `web/` | **视图层源码**（Svelte 5 + Vite） | 组件树（App/Home/Company/Detail + charts）。业务只从 `web/src/lib/data.js` 取 `Selectors`，组件内不做业务计算。路由为 hash 深链（`#/c/<id>/p/<periodId>` 等）。 |
| `test-logic.js` / `test-snapshot.js` | **逻辑回归 / 数据快照** | 逻辑用合成池（不随数据刷新变）；快照读 `data/` 组装结果。 |
| `app.html` | **可运行视图**（构建产物） | 由 `cd web && bun run build` 产出的自包含单文件（JS/CSS/数据全内联，页脚带数据/行情/commit 水印）。派生全部来自 `Selectors`。 |

## 数据流

```
采集（人工/脚本）─▶ tools/merge.py ─▶ data/companies/<id>.json ─[validate.py 目录校验]─▶ data-module.js（读取+派生）─▶ web/（Svelte 组件，只呈现+跳转）─[vite build]─▶ app.html
                        （失败回滚）      ▲ 受 schema.json 约束        ▲ dev/build 由组装器读分片（tools/assemble）
```

派生值（净利率、同比、对账差额、异常标志）**算不存**——这是本项目对抗的核心 bug 类型（改了原始数忘了改派生数 → 对不上账）。

## 构建

视图层是 `web/` 下的 Svelte 5 + Vite 工程；`app.html` 是 `vite-plugin-singlefile` 产出的**自包含单文件**（JS/CSS/数据全内联，便于离线/在受限环境直接双击打开）。首次需装依赖：

```bash
cd web
bun install          # 一次即可
```

开发（热更）与构建：

```bash
bun run dev          # http://localhost:5173 热更开发
bun run build        # 校验闸门 → vite 构建 → 产出仓库根 app.html（自包含单文件）
```

`bun run build` 会先跑 `prebuild`（`validate.py` + `test-data-module.js`），**任一非 0 退出即中止**——脏数据或坏派生逻辑进不了 `app.html`。构建期 `companies.json` 由 Vite 插件内联进 `<script id="dataset">`，`Store.load()` 命中该内联分支（`file://` 下不触发 fetch）。通过 http 部署时可改走 `Store.load()` 里的 `fetch('companies.json')` 外部加载分支。

## 校验

```bash
python3 validate.py data schema.json        # 目录输入（真相源分片，内部组装）
# 兼容：python3 validate.py companies.json schema.json（组装产物文件）
# 可选：pip install jsonschema 后会额外做完整 schema 校验
```

## 测试

```bash
node test-data-module.js
```

推荐完整本地检查顺序（其实就是 `bun run build` 会做的事）：

```bash
python3 validate.py companies.json schema.json
node test-data-module.js
cd web && bun run build     # 校验+测试闸门通过后产出 app.html
```

## 加一家公司

1. 产出公司对象 JSON（参照 schema 必填字段），落 `candidates/` 或直接管道。
2. `python3 tools/merge.py <文件>`——同 id 覆盖/增量，新 id 追加并登记 `company_order`；
   校验失败自动回滚分片。平台合计必须等于营收，否则报错。
3. `python3 tools/diff_data.py <旧状态> data/` 复核这批到底改了什么。
4. `cd web && bun run build` 重建 `app.html`（校验+测试闸门会自动跑）。**主页与下钻无需改动。**

### 下钻会自动适配披露能力

当财报同时披露“报告分部”和更细的“产品/收入类型”时，两层分开存储：

- `segments[]`：报告分部营收与营业利润，例如 Google Services / Google Cloud。
- `revenue_breakdown`：树状产品收入，例如 Google Services → YouTube Ads；父子节点及完整顶层由 `validate.py` 强制对账。

两者不可混在同一个数组，否则产品收入会与其父分部重复计数。下钻页会先展示产品收入层级，再展示报告分部与分部利润。

每家公司带 `seg_profit`：

- `yes`（如三星、博通）：`segments[]` 里填 `op_income` / `op_margin`，下钻**自动出现真实的分部利润与利润率（降序）**。
- `no` / `partial`（如台积电、ASML、NVIDIA）：平台只有营收，下钻**显式留空**并说明，而不是估一个数填进去。

视图据 `Selectors.hasSegmentProfit(year)` 自动二选一，无需为每家公司改代码。

## 后续：采集模块

`validate.py` 已是采集模块的 QA 闸门雏形。采集分层（可靠度从高到低）：
人工录财报 → 解析新闻稿/IR PDF → 对美国公司接 SEC EDGAR XBRL company-facts API。
注意：**分部营业利润、AI 归因**这类关键数结构化 API 基本没有，需人工判断——采集器是 human-in-the-loop。每个数字必须带 `url` + `data_status`。
