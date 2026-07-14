# ROADMAP — 产品回顾后的行动计划(2026-07)

> 来源:2026-07 全量产品回顾(四视角评审 + 实测证据)。
> **核心结论:代码已跑到数据前面——瓶颈、风险、下一波价值全部在数据运营侧。**
> 分析师裁决基线:「诚实的晨会看板,尚非拍板工具」;跨过门槛靠 P0–P2。
>
> 分工约定:「🧑 用户」= 需要用户动手(拉数/丢财报/跑 skill);「🤖 团队」= agent 直接做。
> 数据入库一律走:产出规格 JSON → `python3 tools/merge.py` → validate 0 ERROR → build(失败自动回滚)。
>
> **三条采集通道**(互补,规格见 docs/):
> ① **Dayu MCP**(SEC EDGAR,用户本地)→ 9 家 SEC filer 的基本面+分部+季度,`DATA-SPEC-dayu.md`;
> ② **Tiger**(行情/预期 EPS/汇率)→ D3/D6,`DATA-SPEC-tiger.md`;
> ③ **丢 PDF 人工提取**(非 SEC 4 家:samsung/skhynix/tencent/softbank)→ 台积电模式。

---

## P0 · 完成口径换血(消灭混合态)——当前最大可信度漏洞

背景:已拍板「全量迁真实」。云四家与 ARM 已明显推进到 official 主表口径,但非 SEC 公司、部分历史财年与 TSMC FY2024 偏差仍需继续收敛。
混合态每停留一天,核心视图(迁移图/AI 池/龙头占比)可信度都会打折扣。

- [~] **D1 · 12 家迁真实口径**(🧑 财报 PDF 丢进来 或 Tiger skill 按 `DATA-SPEC-tiger.md` 吐 JSON;🤖 提取/对账/merge)
  - 进展:云四家 google/microsoft/amazon/oracle 已用 Dayu/SEC 补到 official 年度/季度主表;ARM 已补 official。后续优先处理非 SEC 与 TSMC FY2024 官方偏差。
  - 批次优先级:①云四家 google/microsoft/amazon/oracle(已完成主表;oracle 缺云分部经营利润)→ ②存储 samsung/micron/skhynix + 设计 nvda/broadcom → ③其余 asml/softbank/tencent
  - 每家要求:actual 年(营收/毛利率/经营利润/净利/capex/CFO)+ 平台/分部拆分 + 来源标注;**整批换,不留混合**
- [x] **D2 · TSMC FY2024 官方修正**——已按 FY2025 同口径落库:官方美元披露 rev 90.08 / ni 36.52,公司隐含均汇 32.130(=TWD 2,894.31bn÷90.08),op/cfo 按隐含均汇重算(derived),平台拆分 51/35/6/5/1/2 × 90.08 精确对账;`years[]` 与 `periods[]` 双写一致。注:本执行环境 egress 拦 SEC/tsmc.com,数字经多源检索交叉印证(TWD÷隐含均汇/官方USD/分季合计三路闭合),口径注明于 sources。
  - 同批:ARM `quote.net_debt` 补齐 = −3.601bn 净现金(FY2026 20-F @2026-03-31:现金 2.751+短投 0.850,零有息借款,租赁 0.432 按口径排除)→ EV/EV-Sales 点亮,设计环节 EV/Sales comps n=2→3 生效;已用 SEC 原文与本地 Dayu filing `fil_0001973239-26-000097` 复核并标 official。
- [x] **D3 · quote 快照刷新**——11 家美股/ADR/HK 统一刷到 2026-07-07 收盘(nvda/broadcom/tsmc/asml/google/microsoft/amazon/oracle/micron/arm/tencent),micron/arm 首次补 price;net_debt 分量与来源逐字保留(质量 pass 另批)。samsung/skhynix/softbank 韩/日原股按 Tiger 边界跳过,停留 06-26。质量注记:asml 价格由全日跌幅×前收推算、tencent 收盘价多源分歧取市值恒等式最一致值——均在 source 注明待复核;数据源为公开行情检索(estimate),Tiger 精刷可随时覆盖。
- [x] **net_debt 质量 pass**(samsung/skhynix/tsmc/asml/oracle,口径:有息债务−现金及等价物−短投,非美元期末 FX,经营租赁排除)——五家全部刷到 2026 年最新资产负债表:samsung −77.57(1Q26,公司公表净现金 KRW 119.24T 锚)、skhynix −22.77(1Q26,修旧值未含短期金融工具的保守偏差)、tsmc −77.58(1Q26,期末汇率 32.002)、asml −6.52(Q1'26,修旧值年均汇率→期末汇率;变动主因 Q1 现金实降 €4.4B)、oracle **首补 +97.65 净负债**(FY2026 10-K @2026-05-31:债务 129.541−现金 31.289−短投 0.605)→ oracle EV ≈ 506bn(+24%)。全部 estimate(egress 拦一手来源,分量引用注明);待核验项写在各 source:samsung 债务/短投拆分为推导、tsmc 短投为差额推导、oracle 非流动债务依赖聚合站。

## P1 · 点亮 sourced + TTM 补齐——让头牌数字站上硬数据

背景:首页 $291B AI 池 **100% proxy**(营收占比冒充利润占比,零 sourced);
而 google/microsoft/amazon 的**分部经营利润已在库里**(seg_profit=yes),材料早有、只差用起来。

- [x] **D4 · 云厂 AI 归因 proxy→sourced**(🤖 架构师定口径 + 工程师落地;🧑 确认口径)
  - 已用 FY2025/FY2026 已录云分部经营利润推 `ai_profit_share`(带 `ai_share_source`,data_status=derived):google/microsoft/amazon。
  - 口径:云分部经营利润 / 公司总经营利润,是 cloud/AI infrastructure proxy,不是公司披露的 AI-only profit;oracle 分部利润未披露→ 留 proxy。
- [x] **D5 · 季度净利补齐 / Phase 6 final**(🧑 Tiger/Dayu/官方披露;🤖 merge)
  - 进展:google/microsoft/amazon/oracle 已补最近约 8 季;softbank/tencent 仍缺口。
  - 软银收益最低(净利受投资损益主导)可最后/放弃,规格已注明
  - **Phase 6 final 已完成**:`ttmNetIncomeUnified` 已退化为 `periods[] > null`;`profitPoolTTM` 与迁移图 TTM 柱不再消费/展示 `legacy_fallback`;旧 `ttmNetIncome(c)` 仅保留审计对账。
  - **★Retirement pass 执行口径(2026-07-07 用户拍板,逐批照此,不得放宽)**:
    - 采购单以 `node tools/gap-report.cjs` 实跑为准;产物按 DATA-SPEC-dayu §2.A 吐 **periods 部分对象**,走 merge 部分合并。
    - **tsmc / asml:路线 A**——Q1–Q4 全 actual、逐期 FX、**禁止 implied Q4**(季度逐期汇率与年报年均汇率不可硬相减;selector 的 FX 一致性拒绝是契约行为,保留。绝不为省一季而重录季度汇率——数据层不迎合派生逻辑,否则不可审计)。
    - **broadcom / nvda:路线 B**——USD 报表,补缺季后允许 implied Q4。
    - **samsung / skhynix:路线 B 可试**,但**验收必须核 selector 是否因 FX basis 拒绝 implied;若拒绝,不放宽规则,转路线 A**。
    - **D3 quote 刷新先行**(quote-only 部分合并隔离性已验证,低风险前置批次)。
    - **Tiger 边界**:US/HK/ADR 顺;韩/台/日**原股不塞 Tiger**;quote 刷新按可支持标的先更新,**不阻塞** periods 数据批次。
    - Phase 6 final gate 已满足:`legacy_fallback = 0`;legacy 数据留审计。
  - **过渡期双写规则**:在年度视图/估值/AI 池/前瞻链完成广口径迁移前,年度 actual 事实同时写 `periods[]` annual 与 legacy `years[]`(按 `period_end_iso` 增量);季度事实只写 `periods[]`。
- [~] **D8 · 产品收入层级全覆盖**(★2026-07-13 用户拍板:**后续所有公司标配** `revenue_breakdown`,方便按业务板块判断)
  - 口径:filing 的 disaggregation of revenue / 产品收入表按**官方原始层级**录入(years+periods 双挂,季度+年度);与 `segments[]` 严格分开(产品收入 ≠ 分部利润,不重复计数);`complete=true` 两级对账硬闸;对冲损益等调节项带符号单列。规格已入 DATA-SPEC-dayu §2.A。
  - 进展:google 试点已铺满 FY2023–25 + 11 periods(用户,8697fc1)。13 家蓝图已定稿(`docs/plans/revenue-breakdown-blueprint.md`,分析师逐家核披露结构):
    - **批次①(ROI 最高,SEC 10-K 精确金额)**:microsoft/amazon/micron/oracle(oracle 前置闸:拆得出 Cloud→OCI/SaaS 才录,否则=segments 重复,暂缓);
    - **批次②(带口径 caveat)**:nvda(仅当能挂 Data Center→Compute/Networking children)、tsmc(node 表高价值但仅%+晶圆口径→`derived`+`complete=false`,**不造轧差行**)、asml(增量有限最后做);
    - **批次③(非 SEC PDF)**:tencent 先(HKEX 金额齐)→ samsung(注意 division 内部抵消行)/skhynix(占比区间期标 derived);
    - **省略三家(宁缺勿噪)**:arm(=segments)、broadcom(filing 不给产品拆,**不搬电话会 non-GAAP**)、softbank(thesis 在 NAV 不在收入线,录了反而误导)。
    - 红线:micron/skhynix 的 HBM 不在产品表、不得从电话会补录;%口径不冒充 official。
    - **批次①执行结果(2026-07-13)**:入库 **amazon FY2023/FY2025**(七行,official,双写两侧)+ **oracle fy2026q3**(三级 SaaS/OCI 树,official,闸门 PASS:FY2026 起单列 SaaS/OCI)。**扣下待 Dayu 精确补录**(egress 只剩检索通道,以下各项只有舍入级或有自由度,拒绝重构入库):
      - 🧑 **microsoft**:FY2025 10-K 新口径重述表(M365 Commercial/Consumer、Windows and Devices;一张表含三年)+ FY2026 三季 10-Q(`msft-20250630.htm` 等);旧口径 FY2023/24 已采到但缺最新年无决策价值,弃;
      - 🧑 **micron**:10-K/10-Q『Revenue by technology』精确 $M(`mu-20250828.htm` 三年 + `mu-20260226/0528.htm` 两季);检索只有整数占比且 FY2025 DRAM 源间差 ±$230M;
      - 🧑 **amazon FY2024**:Online 247,029 / Physical 21,215 / Other 5,425 三行末位待原表确认(两自由度,恒等式不锁定)+ 可选 2025q3/2026q1 两季;
      - 🧑 **oracle 年度三年**:FY2026 10-K 产品表(cloud application/cloud infrastructure/software support/software license/hardware/services,三年可比)+ fy2026q2 10-Q。
- [ ] **D7 · 自然年口径视图**(🤖 selector 派生 + UI 切换;🧑 确认展示优先级)
  - 结论:可行,但不应把 `years[]` 原始事实改成自然年。`years[]` 继续保存公司披露财年/自然年事实;`calendarYear(company, 2025)` 由季度原子派生 `2025-01-01~2025-12-31`。
  - 边界:只有四个自然年内季度的 revenue/net_income 都齐全才出自然年值;缺季度、只有 guidance 或缺净利时诚实留空。分部自然年拆分需季度分部披露,否则仅公司级自然年。

## P2 · 喂前瞻——从看板跨到决策工具的门槛

背景:前瞻 PE 空盒子已建好(schema/validate/Selector/UI 全就绪),核心大票已点亮;
分析师头号诉求:「不做前瞻,comps 对我只是起点;做了,我天天开它。」

- [x] **D6 · consensus EPS 灌入**(🧑 Tiger/公开一致预期源;🤖 merge)
  - 已完成核心大票 forward PE:nvda/broadcom/tsmc/asml/google/microsoft/amazon/oracle。
  - 字段:forecast 年 `consensus_eps_value` + `consensus_eps_currency` + `consensus_eps_source`(**data_status 必为 consensus**)。
  - tsmc/asml 已把 TWD/EUR 预测 EPS 归一为 USD ADR / NASDAQ registry-share 口径,避免跨币硬算。

## P3 · 工程加固(小而防烂,🤖 团队直接做,不依赖数据)

- [x] **E1 · validate.py TODAY 去硬编码**——已改为真实 `date.today()`;quote 新鲜度随真实日期滚动。
- [x] **E2 · 测试拆分:逻辑回归 vs 数据快照**——已拆为 `test-logic.js` + `test-snapshot.js`;数据刷新用快照更新,逻辑回归保持稳定。
- [ ] **E3 · FX 口径统一**——各公司历史条目汇率来源异质(都有标注、不算错);随 D1 换血顺手统一为「公司隐含均汇优先,否则期间均汇,来源注明」
- [~] **E4 · period-base 数据模型重构**(🤖 团队;计划见 `docs/plans/period-base-refactor.md`)——把 app 重建在 report-period 原子(`periods[]`)之上,FY/CY/TTM/最新季/AI 归因/估值全由 Selector 派生。
  - **Phase 1–5 全量完成 14/14**:schema `periods[]` + validate 契约、selector 层(periods/calendarYear/ttmFromPeriods/fiscalYearFromPeriods/companyMetricView + implied Q4 派生 + 严格 CY 边界)、四镜头视图、14 家公司全部迁入 `periods[]`。
  - **Phase 6 final 落地(窄口径)**:6.1 `years[]/quarters[]` 标 legacy(schema/DATA-SPEC/本文,零行为变化);6.2 final `ttmNetIncomeUnified`(periods > null)接入 `profitPoolTTM`,迁移图 TTM 柱为单一 periods 口径。`years[]` 仍服务年度视图/估值/AI 池/前瞻链,广口径迁移另立项。
  - **广口径迁移 B1(估值链)已落地**(2026-07-08,ADR `docs/plans/broad-migration-b1-valuation.md`):`pe/ps/evSales/fcfYield` 分母改读 periods 侧 `latestActualAnnual`/`latestCashActualAnnual`(纯 periods,无运行时回退);`validate.py` 加「双写一致性」硬 ERROR 兜底。四门禁全绿、快照零漂移、视图零改动。剩余三批(年度视图/桑基 → AI 池 → 前瞻)待续。
  - **广口径迁移 B2(年度视图/桑基)最小批已落地**(2026-07-08,ADR `docs/plans/broad-migration-b2-annual-views.md`):**D1** `ValuationCard` 展示锚从 `latestActual` 迁 `latestActualAnnual`(`la.fy`→`la.fiscal_year`,同串零可见变化,closes #13);**D4** `validate.py` 双写一致性从 `revenue/net_income` 扩到 `op_income/cfo/capex + 逐分部`(name 对齐后 `revenue/op_income/op_margin/is_ai/kind` 相等),硬 ERROR。四门禁全绿(945/945 平价、快照零漂移)、web/src 除 ValuationCard 零改动。**D2/D3 数值行整迁门控在 annual period 的 `gross_profit` 补录**(periods 侧无毛利事实,硬迁会让毛利/毛利率整列消失);Home L230 自由文本锚保留 years。

## P4 · 产品决策(不排期,需要用户拍板后才动)

- [ ] **comps 样本厚度**:相对估值半数环节「样本不足」(设计 n=2、代工/设备 n=1)。选项:按环节各补 1–2 家(AMD/Intel?联电?LamResearch/KLA?)vs 接受只对存储/云生效
- [ ] URL 深链(hash 路由方案已备好,1 人日)· 历史估值分位(需时间序列采集,重)· 桑基声明式重写(已登记 TECH-DEBT,无交互需求不动)

---

## 完成的定义(DoD)

P0–P2 全部完成时,产品应满足:
1. 13 家全部真实口径、来源可溯,无情景/真实混合;
2. AI 池头牌数字含 ≥3 家 sourced 归因,首页 basisCount 如实反映;
3. TTM 柱覆盖 ≥12 家(软银可豁免);
4. 前瞻 PE 对 ≥5 家点亮,与 trailing 严格分列;
5. 全程 validate 0 ERROR · 测试绿 · lint 0 · 单文件产物可双击打开。

届时重跑一次分析师评审,验收「看板 → 决策工具」是否跨线。
