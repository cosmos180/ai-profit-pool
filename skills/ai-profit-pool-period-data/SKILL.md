# ai-profit-pool-period-data

用于 Multica / Codex / Claude 等 agent 协作补齐 `ai-profit-pool` 的上市公司财报数据。目标不是写分析文章,而是产出可审计、可 merge、可回归测试的 `periods[]` 报告期原子数据。

## 0. 角色边界

你是数据采集与初审 agent。你可以查官方财报、抽取数字、做交叉校验、输出 JSON 草稿,但不要直接改 `companies.json`、不要改 UI、不要提交代码。最终 merge、build、提交由项目负责人完成。

交付物必须是一个或多个公司部分对象:

```json
{
  "id": "amazon",
  "periods": []
}
```

只补 `periods[]`。不要输出 `years[]` / `quarters[]` / `quote` / `valuation` / 判断项。

## 1. 核心目标

每条 `periods[]` 是一个官方报告期事实:

- `kind`: `quarter` 或 `annual`
- `status`: `actual` 为主; `guidance` / `forecast` 只能在任务明确要求时使用
- 事实来自官方 filing / earnings release / investor relations 财报材料
- FY / CY / TTM / 最新季 / 利润池由 selector 派生,不要在数据层预先计算存储

优先补季度实际数据,特别是能消灭 `legacy_fallback` 的缺口。

## 2. 权威来源顺序

优先级从高到低:

1. SEC EDGAR: 10-Q, 10-K, 20-F, 6-K, 8-K earnings release
2. 公司 Investor Relations 官方财报 PDF / HTML / XLS
3. 交易所披露页面: HKEX, KRX, TSE 等
4. 公司官方 presentation / financial supplement

不要用二手网站补实际财报字段。StockAnalysis、Yahoo、Macrotrends 等只能用于发现线索,不能作为最终 source。拿不到官方数就填 `null`。

## 3. 单位与字段契约

财务字段单位一律是 USD billions:

- `revenue`, `gross_profit`, `op_income`, `net_income`, `cfo`, `capex`
- 例如 181,519 million USD 写成 `181.519`
- `capex` 填现金流里的资本开支绝对值,不要填负数
- 缺失填 `null`,不要填 `0`
- 毛利、经营利润、CFO、capex 如果官方季度报表未清晰披露,宁可 `null`

币种字段:

- `currency` 是源报表币种
- `fx_to_usd` 是“源币 / USD”
- USD 公司填 `1`
- 非 USD 公司必须写明汇率来源和口径
- 不要把 `USD / source-currency` 方向塞进 `fx_to_usd`

重要:不要混用季度逐期汇率和年度均汇做 `annual - Q1 - Q2 - Q3`。FX 不一致时,implied Q4 必须失败,应改补四季 actual。

## 4. Period 标注规则

必须同时填自然年与财年:

```json
{
  "period_id": "nvda-fy2026q2",
  "kind": "quarter",
  "status": "actual",
  "period_start": "2025-04-28",
  "period_end": "2025-07-27",
  "calendar_year": 2025,
  "calendar_quarter": "Q3",
  "fiscal_year": "FY2026",
  "fiscal_quarter": "Q2"
}
```

`calendar_quarter` 按 `period_end` 落入哪个自然季度。财年错位公司尤其要小心,NVIDIA / Broadcom / Micron 的 FY 与 CY 经常不同。

`period_id` 参照库内既有命名:

- 自然年季度: `amazon-2026q1`, `tencent-2026q1`
- 财年季度: `nvda-fy2026q2`, `broadcom-fy2025q3`
- 年度: `tencent-fy2025`, `softbank-fy2025`

## 5. Q4 与 TTM 规则

美股 Q4 通常不发 10-Q,Q4 包在 10-K 里。不要因为没有 10-Q 就说没有 Q4 数据。

允许两条路线:

- 路线 A: 补 Q1-Q4 四个 actual quarter,最稳
- 路线 B: 有 annual + Q1-Q3 时,selector 读时派生 implied Q4

路线 B 的硬约束:

- annual 与 Q1-Q3 同 `currency`
- annual 与 Q1-Q3 同 `fx_to_usd`
- 年度事实和前三季字段口径一致
- 只能由 selector 读时算,不要把 implied Q4 写入 `companies.json`

已拍板口径:

- `tsmc` / `asml`: 走路线 A,禁止 implied Q4
- `broadcom` / `nvda`: USD 报表,可走路线 B
- `samsung` / `skhynix`: 路线 B 可试;FX 被 selector 拒绝时转路线 A,不放宽规则

## 6. 分部数据规则

`segments[]` 只填官方披露的分部事实:

```json
{
  "name": "AWS 亚马逊云",
  "kind": "platform",
  "revenue": 37.587,
  "op_income": 14.161,
  "op_margin": 0.377,
  "is_ai": true
}
```

规则:

- 平台型分部营收合计应与公司 revenue 对上
- 公司只披露 division 而非 platform 时,不要硬凑平台合计
- `is_ai` 是人工判断项;不确定时留给负责人,不要凭感觉新增
- 分部经营利润不是公司净利润,不要混用
- Amazon 这类公司不披露传统 gross profit 时,`gross_profit` 可以是 `null`

## 6.5 产品收入层级(`revenue_breakdown`,★全公司标配 2026-07-13 拍板)

与 `segments[]` 严格分开:产品收入 ≠ 分部利润口径,不重复计数。filing 有
disaggregation of revenue / 产品收入表就录,没有就省略整键(不硬凑)。

```json
"revenue_breakdown": {
  "label": "产品与收入类型", "complete": true,
  "items": [
    { "name": "Google Services 谷歌服务", "revenue": 342.721,
      "children": [ { "name": "Google Search & other 搜索及其他", "revenue": 224.532 } ] },
    { "name": "Hedging gains (losses) 对冲损益", "revenue": -0.127 }
  ],
  "sources": [ { "label": "10-K Note 2 revenue disaggregation", "url": "…", "data_status": "official" } ]
}
```

规则:按官方表原始行名/层级录(可加中英对照),不合并不改名;`complete=true` 时顶层合计
必须精确=revenue,带 children 的节点子项必须精确=父节点(validate 两级硬对账);对冲/
调节项带符号单列;years 与 periods 都挂(年度+季度);各家层级照
`docs/plans/revenue-breakdown-blueprint.md` 蓝图录。

## 7. 常见坑

- 把 YTD 现金流当季度现金流:很多 10-Q 的 CFO/capex 是累计数,需要确认是三个月还是六/九个月
- 把非 GAAP adjusted net income 当 GAAP net income
- 把归母净利与 total net income 混用
- 把 forecast / consensus 当 actual
- 把 filing date 当 period_end
- 把 fiscal Q2 写成 calendar Q2
- 把 capex 写成负数
- 把 `fx_to_usd` 方向写反
- 用二手网站数字覆盖官方 filing
- 为了点亮图表而编造 gross_profit / op_income

## 8. 自校验

每个交付必须附 `_selfcheck`,负责人 merge 前会删除:

```json
{
  "_selfcheck": {
    "source_refs": [
      "Amazon Form 10-Q filed 2026-05-01, period ended 2026-03-31"
    ],
    "raw_figures": [
      "Net sales 181,519 million; operating income 23,852 million; net income 30,296 million"
    ],
    "ytd_check": "CFO/capex confirmed as three months ended 2026-03-31, not six/nine-month YTD",
    "segment_check": "104.143 + 39.789 + 37.587 = 181.519",
    "fx_check": "USD filer, fx_to_usd=1"
  }
}
```

没有 `_selfcheck` 的数据视为未完成。

## 9. 本地验收命令

负责人 merge 前后使用:

```bash
python3 tools/merge.py candidate.json --dry-run
python3 tools/merge.py candidate.json --no-build
cd web
bun run build
```

验收必须满足:

- `validate.py` 为 0 ERROR
- logic test 通过
- snapshot test 只有预期数据变化
- lint 通过
- 根目录 `app.html` 重新生成

## 10. Multica 分工建议

不要把所有公司一次性扔给一个 agent。按公司拆小任务,每个任务只交付一个公司的一个批次。

推荐分组:

- 半导体: `nvda`, `broadcom`, `micron`, `tsmc`, `asml`, `samsung`, `skhynix`
- 云与平台: `microsoft`, `google`, `amazon`, `oracle`, `tencent`
- 投资控股: `softbank`

每个 agent 的交付格式:

1. 官方来源链接
2. JSON 部分对象
3. `_selfcheck`
4. 未能填入字段及原因
5. 是否影响 `legacy_fallback`

负责人只接受可追溯数据,不接受“应该是”“估算”“网上看到”的数字。
