# tools/ — 数据采集(与 app 解耦)

这里放**独立的取数辅助脚本**。它们不属于 app 运行时(不被 `build.py` 打包、不被视图依赖),
只负责把外部数据源变成 `companies.json` 需要的形状。产物照常过 `validate.py` 才算数。

数据流:`tools/*`（取数）─▶ 人工核验/补判断项 ─▶ `companies.json` ─[validate.py]─▶ app

## fetch_fmp.py — Financial Modeling Prep → 公司对象

零依赖(仅标准库)。输入 ticker + FMP key,输出一个 `companies.json[companies]` 形状的对象。

```bash
export FMP_API_KEY=你的key
python3 tools/fetch_fmp.py NVDA               # 最简:id=nvda、name=FMP 公司名,自动
python3 tools/fetch_fmp.py NVDA MSFT ORCL AMD # 批量 → 输出 JSON 数组
python3 tools/fetch_fmp.py MSFT --out /tmp/msft.json
```

- `id` 默认=ticker 小写,`name` 默认=FMP 公司名(中文名等追加进 companies.json 后自己改)。
- 默认走 FMP 当前的 **stable API**;若套餐仍是旧接口、stable 返回 403,加 `--legacy` 走 `/api/v3`。
- `--quarters`(季度/TTM)需更高档套餐;免费/基础档会返 402,自动跳过。

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

## merge.py — 合并进 companies.json + 校验 + 构建(一条龙)

`fetch_fmp.py` 只吐对象、**不写盘**(与 app 解耦)。`merge.py` 是下游收尾:按 id 合并进
`companies.json`,强制过 `validate.py`,**只有 0 ERROR 才写盘并 `build.py`**;任一步失败自动
回滚,保证仓库里的 `companies.json` 永远是校验通过的状态。

```bash
# 取数 → 合并 → 校验 → 构建,一条命令
python3 tools/fetch_fmp.py NVDA MSFT ORCL AMD | python3 tools/merge.py -

python3 tools/merge.py /tmp/new.json            # 从文件合并
python3 tools/merge.py /tmp/new.json --dry-run  # 只看会改动谁,不写盘
python3 tools/merge.py /tmp/new.json --no-build # 合并+校验,暂不重建 app.html
```

- 合并规则:同 id → 覆盖并提示;新 id → 追加。
- **覆盖保护**:重新取数覆盖已有公司时,若新对象缺判断项(`chain_stage`、`seg_profit`、
  `segments[].is_ai`、`valuation_caveat`、中文 `name`/`logo` 等),会自动**保留旧对象里手工补的值**
  —— 一次取数不会把你之前补录的判断项冲掉。
- 合并后若某公司仍缺 `chain_stage` 或 `is_ai` 分部,会提示它暂不参与利润池迁移/AI 加权池
  (其余页面正常显示,honest 降级)。

### 用法建议
1. 跑 `fetch_fmp.py` → 得到对象;2.(可选,建议)补齐判断项、做 USD 换算与数量级核验;
3. `merge.py` 一条龙合并+校验+构建;4. 打开 `app.html`。全程不改任何代码。

> 若手工合并:把对象追加进 `companies.json` 的 `companies[]` →
> `python3 validate.py companies.json schema.json`(0 ERROR)→ `python3 build.py`。
