# tools/ — 数据采集(与 app 解耦)

这里放**独立的取数辅助脚本**。它们不属于 app 运行时(不被 `build.py` 打包、不被视图依赖),
只负责把外部数据源变成 `companies.json` 需要的形状。产物照常过 `validate.py` 才算数。

数据流:`tools/*`（取数）─▶ 人工核验/补判断项 ─▶ `companies.json` ─[validate.py]─▶ app

## fetch_fmp.py — Financial Modeling Prep → 公司对象

零依赖(仅标准库)。输入 ticker + FMP key,输出一个 `companies.json[companies]` 形状的对象。

```bash
export FMP_API_KEY=你的key
python3 tools/fetch_fmp.py NVDA --id nvda --name "NVIDIA 英伟达" --years 4 --quarters
python3 tools/fetch_fmp.py MSFT --out /tmp/msft.json
```

### 自动填(来自 FMP,单位换成 USD bn,`data_status: "derived"`)
| schema 字段 | FMP 来源 |
|---|---|
| revenue / net_income / op_income | income-statement |
| gross_margin | grossProfit ÷ revenue（原样披露比率） |
| capex / cfo | cash-flow-statement |
| quote.market_cap / price | quote |
| quote.net_debt | balance-sheet（FMP netDebt：总债务−现金及短投,负=净现金） |
| years[].period_end / period_end_iso | 报表日期 |
| quarters[]（`--quarters`） | income-statement?period=quarter（供 TTM 自滚） |

### 必须你人工补的(API 给不了的判断项 → 脚本留 null/占位)
`chain_stage`、`ai_exposure`、`seg_profit`、`segments[]` 及其 `is_ai`、`valuation_caveat`、`id`。

### 诚信约定(脚本已内建)
- 缺字段 → 留 null,绝不编造/填 0。
- 每个数带 FMP 来源 URL、`data_status: "derived"`(FMP 是聚合源非一手 filing;你对照 10-K/20-F 后可改 `official`)。
- **非美元公司**(台积电/三星/腾讯/海力士等本币报表):数值是**本币 bn 不是 USD bn**,对象会带 `_fx_todo` 标记——**提交前必须换算成 USD bn** 并在 source 注明汇率。
- FMP 免费版仅覆盖美股+有限历史;非美股/完整报表需付费套餐。

### 用法建议
1. 跑脚本 → 得到对象;2. 删掉 `_notes`/`_fx_todo`,补齐判断项、做 USD 换算与数量级核验;
3. 追加进 `companies.json` 的 `companies[]`;4. `python3 validate.py companies.json schema.json` → 0 ERROR;
5. `python3 build.py`。全程不改任何代码。
