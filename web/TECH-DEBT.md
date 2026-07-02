# 技术债登记（web/ 视图层）

本表登记视图层中「已知、经评审接受、有明确偿还触发条件」的过渡债。
数据/派生层的债不在此（那里靠 `test-data-module.js` + `validate.py` 兜）。

## 1. Sankey.svelte 仍用 `{@html}` 命令式 SVG 字符串（ADR 决策 4 允许的过渡债）

- 现状：`web/src/charts/Sankey.svelte` 的 `buildSankey(c, y)` 是命令式累积
  SVG 字符串（`curX/curVal/curTop` 逐段推进 band/advance），最终经 `{@html}` 注入。
  其余图表（Trend/Migration）已是声明式 `{#each}` + `$derived` 几何。
- 为什么可接受：
  - **无 XSS**：函数内所有外部文本都过 `Safe.text/Safe.attr`；`{@html}` 注入的是本
    组件纯函数产物，不含用户输入。
  - **不违反不变量 5**：函数内【不做财务算术】——金额/比率全部来自
    `Selectors.incomeFlow(y)` / `Selectors.opMargin` / `Selectors.netMargin`，
    函数内只做布局坐标与 px 缩放（桑基流带宽度 ∝ 金额，属几何非财务量）。
  - **null 安全**：`has.*` 为 false 时优雅降级（缺 gross_margin 不画毛利段等），
    不伪造 0、不估算。
- 偿还触发条件：**仅当桑基要加新交互（hover/focus 高亮、点击下钻）或新降级态时**，
  才重构为声明式 `{#each}` <rect>/<path>/<text>（几何用 `$derived`，输入只能是
  Selectors 返回值），与 Migration.svelte 同构。当前无此需求，保留过渡债。
- 备注（迭代 A 收敛）：桑基外框已从写死 `width/height` 改为 `viewBox` + CSS
  等比缩放（A1）；分部占比标签已改用 `Selectors.incomeFlow` 的 `segment.share`
  下沉派生（A2）+ `Fmt.pctCompact` 防归零（A4）。命令式 SVG 本身的债不变。
