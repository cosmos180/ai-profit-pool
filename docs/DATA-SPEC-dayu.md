# DATA-SPEC-dayu — Dayu MCP(SEC EDGAR)取数规格

> ⚠ **新采集目标已切换为 `periods[]`(period-base 重构)。** `years[]` / `quarters[]` 已标 legacy(迁移兼容层,仅供旧视图/回退,最终退役见 `docs/plans/period-base-refactor.md` Phase 6.2)。
> 新数据请按报告期原子录入 `periods[]`:每条是一个 reported-period 事实(`kind` = quarter | annual、`status` = actual | guidance | forecast),带 `period_start/period_end`(机读 ISO)、`calendar_year/calendar_quarter`、`fiscal_year/fiscal_quarter`、`currency/fx_to_usd`(非 USD 源必带正 `fx_to_usd`)、可空财务字段与 `sources[]`(url + data_status)。形状要点见计划文档 **Target Data Shape** 一节;字段映射细节可后续修订,本轮先立牌子。TTM/CY/FY 一律由 Selector 派生(算不存)。
>
> Dayu 是第三条采集通道,与 Tiger、「丢 PDF 人工提取」互补。跑在**用户本地**(需 DeepSeek key + EDGAR)。
> 共享规则(单位 USD bn、id 硬清单、判断项不输出、输出 JSON 形状、merge 流程、自检清单)
> **一律沿用 `DATA-SPEC-tiger.md` 第 1/4/5/7/8 节**,本文只写 Dayu 特有的部分。

## 0. 覆盖矩阵(先知道它能干什么)

| 通道 | 覆盖 | 对应 ROADMAP |
|---|---|---|
| **Dayu(本文)** | SEC filer 9 家:nvda/broadcom/micron/google/microsoft/amazon/oracle(10-K/10-Q)+ tsmc/asml(20-F/6-K)。基本面 + **分部附注** + 季度 | D1 主力 · D2 · D4 · D5(4/6 家) |
| Tiger | 行情快照(D3)、预期 EPS(D6)、汇率;非美股财报兜底 | D3 · D6 |
| 丢 PDF 人工提取 | 非 SEC 的 4 家:samsung/skhynix(KRX)、tencent(HKEX)、softbank(TSE) | D1 批次③ |

Dayu **不要**用于:市值/股价(不在 filing)、consensus EPS(不在 filing)、非 SEC 公司。

## 1. LLM 中介提取的诚信规则(比 Tiger 多出来的部分)

Dayu 读的是官方文件,但它是 LLM 转述——**转述可能错,所以产物必须过交叉验证才算数**:

1. **强制附带自校验值**:每次提取都让 Dayu 同时给出 filing 里**明文披露的比率**(毛利率/经营利润率/分部占比),
   与提取的绝对值互相验算(如 gross_profit÷revenue 是否等于披露的 GM)。不一致 → 整家打回重取,不修不猜。
2. **平台对账**:分部营收合计必须等于总营收(platform)——validate.py 会强制,提前在 Dayu 侧核一遍。
3. **provenance 到 filing**:每条 source label 必须含 **filing 类型 + 提交日期**(如「10-K filed 2026-02-21」,
   Dayu 返回里有),url 用该公司 EDGAR filing 索引页;`data_status: "official"`(一手文件)。
4. **杜绝记忆污染**:提示词里明确要求「只用本次检索到的 filing 原文数字,禁止用你训练记忆里的数字补空」;
   拿不到就 null(留空也比填错好)。

## 2. 给 Dayu 的提取提示词模板(dayu_prompt / dayu_turn,逐家跑)

> ticker 用真实交易代码(MSFT/GOOGL/AMZN/ORCL/NVDA/AVGO/MU/TSM/ASML);
> 但输出 JSON 的 `id` 必须按 DATA-SPEC-tiger 第 1.1 节的**硬清单**(microsoft/google/amazon/oracle/nvda/broadcom/micron/tsmc/asml)。

```
读取 {TICKER} 最新年报(10-K 或 20-F)与最近约 8 个季度的季报(10-Q/6-K),只用本次检索到的
filing 原文数字(禁止用记忆补空,拿不到留 null),提取并输出一个 JSON 对象:

{
  "id": "<按硬清单>", "name": "<英文名>", "ticker": "<交易所 · 代码>",
  "region": "<国家>", "sector": "<行业>", "currency": "<财报币种 ISO>",
  "status": "populated",
  "years": [  // 最近 3 个完整财年,升序,每年:
    { "fy": "FY20XX", "period_end": "截至 YYYY-MM-DD", "period_end_iso": "YYYY-MM-DD",
      "status": "actual",
      "revenue": <USD bn,4位小数>, "gross_margin": <0-1 或 null>,
      "op_income": <USD bn>, "net_income": <归母 GAAP,USD bn>,
      "capex": <绝对值 USD bn>, "cfo": <USD bn>,
      "segments": [ // 仅当 filing 有分部/平台披露;kind: platform(合计=营收)或 division
        { "name": "<分部名>", "kind": "platform", "revenue": <USD bn>,
          "op_income": <USD bn 或 null,分部利润有披露才填> } ],
      "sources": [ { "label": "<filing 类型+财年+提交日期+表名>",
                     "url": "<EDGAR filing 索引页>", "data_status": "official" } ] }
  ],
  "quarters": [ // 最近约 8 季,升序(供 TTM):
    { "period_end": "YYYY-MM-DD", "label": "QX FY20XX",
      "net_income": <USD bn>, "revenue": <USD bn>,
      "sources": [ { "label": "<10-Q/6-K+提交日期>", "url": "<EDGAR>", "data_status": "official" } ] }
  ],
  "_selfcheck": {  // 自校验(merge 前人工核对后删除):
    "disclosed_gross_margin": "<filing 明文披露的毛利率原文>",
    "disclosed_op_margin": "<同上>",
    "segment_sum_equals_revenue": "<逐年:分部合计 vs 营收,差额>",
    "filing_refs": ["<每份用到的 filing:类型/财年/accession/提交日>"]
  }
}

硬规则:单位一律 USD bn(÷1e9,4位小数);非美元报表按 filing 自己披露的美元数优先,否则注明
所用汇率与口径;capex 取绝对值;net_income 取归母 GAAP;缺任何字段填 null 绝不编造;
不要输出 chain_stage / ai_exposure / ai_profit_share / valuation_caveat / seg_profit /
is_ai / 中文名(判断项,人工负责);不要输出市值/股价/预期 EPS(不在 filing)。
```

## 3. 入库流程(与其他通道一致)

```
你本地:Dayu 按模板产出 JSON(每家一个对象,可拼数组)
   ↓ 核对 _selfcheck(比率验算/对账/filing 引用),核完删掉 _selfcheck 键
   ↓ 丢进会话 或 本地直接:python3 tools/merge.py dayu-out.json
   ↓ merge 按 id 合并(判断项/中文名/segments is_ai 由覆盖保护保留)
   ↓ validate 0 ERROR 才写盘 → bun run build → app.html
```

- **分部 `is_ai` 标注**:Dayu 提取分部营收/利润,但 **is_ai 是判断项**——merge 的 segments 保留逻辑
  按 `period_end_iso` 对齐旧年;**新财年的分部需要人工补 is_ai** 后才进 AI 池(merge 会提示)。
- 与 Tiger 数据合并顺序:**先 Dayu(基本面,official)后 Tiger(quote/consensus,derived)**,
  两者字段不重叠、互不覆盖。
- `dayu_write`(买方报告流水线)与本数据流无关;后续可作为 analyst agent 的对照素材,另议。

## 4. 批次建议(对应 ROADMAP)

1. **批次①(D1+D4+D5 三合一)**:MSFT → GOOGL → AMZN → ORCL。10-K 的分部附注顺带拿云分部经营利润
   (喂 D4),10-Q 顺带拿季度(喂 D5)。**先跑 MSFT 一家验证全链路,过了再批量。**
2. **批次②**:NVDA → AVGO → MU(10-K/10-Q)+ TSM FY2024 20-F(补 D2 的平台拆分)+ ASML 20-F。
3. **批次③(Dayu 覆盖不到)**:samsung/skhynix/tencent/softbank —— 年报 PDF 丢进会话人工提取(台积电模式)。
