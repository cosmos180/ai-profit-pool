# AI 利润池 · 解耦后的数据/视图架构

数据已从界面剥离。各层职责单一，存储技术可替换。

## 文件

| 文件 | 角色 | 说明 |
|---|---|---|
| `companies.json` | **权威存储**（唯一真相源） | 只放原始、有来源的事实。**不存任何派生值**。 |
| `schema.json` | **数据契约** | JSON Schema。存储、采集、视图都依赖它，不互相依赖。 |
| `validate.py` | **入库 QA 闸门** | schema 校验 + 平台合计对账 + provenance 检查。出错 `exit 1`，可挡流水线。 |
| `data-module.js` | **数据访问层** | `Store`（加载）+ `Selectors`（派生：利润率/同比/对账/排序）。无 DOM、无格式化。 |
| `web/` | **视图层源码**（Svelte 5 + Vite） | 组件树（App/Home/Company/Detail + charts）。业务只从 `web/src/lib/data.js` 取 `Selectors`，组件内不做业务计算。 |
| `test-data-module.js` | **选择器测试** | 覆盖核心派生逻辑：最新实际年、预测年、对账、分部利润等。 |
| `app.html` | **可运行视图**（构建产物） | 由 `cd web && bun run build` 产出的自包含单文件（JS/CSS/数据全内联）。派生全部来自 `Selectors`。 |

## 数据流

```
采集（人工/脚本）─▶ companies.json ─[validate.py 校验]─▶ data-module.js（读取+派生）─▶ web/（Svelte 组件，只呈现+跳转）─[vite build]─▶ app.html
                       ▲ 受 schema.json 约束
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
python3 validate.py companies.json schema.json
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

1. 往 `companies.json` 的 `companies[]` 推入一个对象（参照 schema 必填字段）。
2. 把它的 `status` 从 `pending` 改为 `populated`，填入 `years[]`。
3. 跑 `validate.py`——平台合计必须等于营收，否则报错。
4. 跑 `test-data-module.js` 确认派生逻辑没有被破坏。
5. `cd web && bun run build` 重建 `app.html`（校验闸门会自动跑）。**主页与下钻无需改动。**

### 下钻会自动适配披露能力

每家公司带 `seg_profit`：

- `yes`（如三星、博通）：`segments[]` 里填 `op_income` / `op_margin`，下钻**自动出现真实的分部利润与利润率（降序）**。
- `no` / `partial`（如台积电、ASML、NVIDIA）：平台只有营收，下钻**显式留空**并说明，而不是估一个数填进去。

视图据 `Selectors.hasSegmentProfit(year)` 自动二选一，无需为每家公司改代码。

## 后续：采集模块

`validate.py` 已是采集模块的 QA 闸门雏形。采集分层（可靠度从高到低）：
人工录财报 → 解析新闻稿/IR PDF → 对美国公司接 SEC EDGAR XBRL company-facts API。
注意：**分部营业利润、AI 归因**这类关键数结构化 API 基本没有，需人工判断——采集器是 human-in-the-loop。每个数字必须带 `url` + `data_status`。
