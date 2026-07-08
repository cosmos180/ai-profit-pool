# tools/ — 数据采集(与 app 解耦)

这里放**独立的取数辅助脚本**。它们不属于 app 运行时(不被前端构建打包、不被视图依赖),
只负责把外部数据源变成 `companies.json` 需要的形状。产物照常过 `validate.py` 才算数。

数据流:`tools/*`（取数）─▶ 人工核验/补判断项 ─▶ `companies.json` ─[validate.py]─▶ app

## fetch_fmp.py — Financial Modeling Prep → 公司对象

零依赖(仅标准库)。输入 ticker,从环境变量或本地 env 文件读取 FMP key,输出一个
`companies.json[companies]` 形状的对象。

推荐本地配置:复制 `.env.example` 为 `.env.local`,填入真实 key。`.env.local` 已被
gitignore 忽略,不要提交真实密钥。CI/生产环境应使用 GitHub Actions Secrets / CI Variables
等 Secret Manager 注入 `FMP_API_KEY`。

```bash
cp .env.example .env.local
$EDITOR .env.local
python3 tools/fetch_fmp.py NVDA               # 最简:id=nvda、name=FMP 公司名,自动
python3 tools/fetch_fmp.py NVDA MSFT ORCL AMD # 批量 → 输出 JSON 数组
python3 tools/fetch_fmp.py MSFT --out /tmp/msft.json
```

也可以直接使用 shell 环境变量:

```bash
export FMP_API_KEY=你的key
python3 tools/fetch_fmp.py NVDA
```

`--key` 仅建议临时调试使用,不推荐长期使用,因为它可能进入 shell history 或进程列表。

- `id` 默认=ticker 小写,`name` 默认=FMP 公司名(中文名等追加进 companies.json 后自己改)。
- 默认走 FMP 当前的 **stable API**;若套餐仍是旧接口、stable 返回 403,加 `--legacy` 走 `/api/v3`。
  若 stable 返回 402、legacy 返回 403,说明当前 FMP key/套餐无权访问这些接口或该 ticker 数据。
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
`companies.json`,强制过 `validate.py`,**只有 0 ERROR 才写盘并 `cd web && bun run build`**;任一步
失败自动回滚,保证仓库里的 `companies.json` 永远是校验通过的状态。

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

### 部分合并(quote-only / periods-only 增量并入)

merge 会按**对象形状**自动分两种模式,无需额外命令行开关:

| 对象形状 | 判定信号 | 行为 |
|---|---|---|
| **完整对象** | 含 `years` 且未带 `"_partial": true` | 整对象覆盖(上面的覆盖保护照旧)——**现行行为零变更** |
| **部分对象** | 缺 `years`,或显式 `"_partial": true` | **部分合并**:只更新对象里【提供的顶层键】,未提供的键一律保留旧值 |

设计取舍:以「缺 `years`」作为部分对象的默认信号,是为了**拒绝静默整替换**——旧流程里一个
quote-only 对象会把公司的 `years/quarters/periods` 全部冲成缺省。要对 `years` 本身做增量时,
显式带 `"_partial": true` 即可(此时可携带 `years` 并走增量并入)。

部分合并语义(**只更新提供的顶层键**):

- `quote` 及其余非数组键 → **整体替换**该键;
- `periods` → 按 `period_id` **增量并入**:同 `period_id` 替换该条、新 `period_id` 追加、其余 periods 不动,并入后按 `period_end` 排序;
- `quarters` → 按 `period_end`、`years` → 按 `period_end_iso` 同理增量并入;
- **未提供的顶层键一律保留旧值** —— 吐 quote-only / periods-only 不会冲毁公司其余数据。

约束与报错(仍人话、失败即回滚):

- 部分对象**只能更新已存在的公司**;指向不存在的 id → 报错(先用完整对象录入这家公司)。
- 增量数组里每条必须带对应主键(`periods` 的 `period_id` 等);缺键或一次并入内主键重复 → 报错、不写盘。
- 合并后仍强制过 `validate.py`,0 ERROR 才写盘并构建;任一步失败自动回滚。

```bash
# 只刷行情:吐一个 quote-only 部分对象(缺 years → 部分合并),其余数据分毫不动
echo '{"id":"nvda","quote":{...}}' | python3 tools/merge.py - --dry-run   # 先 dry-run 看会改哪些键
echo '{"id":"nvda","quote":{...}}' | python3 tools/merge.py -

# 只补季度原子:吐 periods-only 部分对象,按 period_id 增量并入
python3 tools/merge.py /tmp/nvda-periods.json --dry-run   # 报告 "periods: 替换 N / 新增 M"
python3 tools/merge.py /tmp/nvda-periods.json
```

dry-run 会明确区分「**整对象覆盖**」与「**部分更新(哪些键 / 数组替换N·新增M)**」,便于下手前确认影响面。

### 用法建议
1. 跑 `fetch_fmp.py` → 得到对象;2.(可选,建议)补齐判断项、做 USD 换算与数量级核验;
3. `merge.py` 一条龙合并+校验+构建;4. 打开 `app.html`。全程不改任何代码。

> 若手工合并:把对象追加进 `companies.json` 的 `companies[]` →
> `python3 validate.py companies.json schema.json`(0 ERROR)→ `cd web && bun run build`。
