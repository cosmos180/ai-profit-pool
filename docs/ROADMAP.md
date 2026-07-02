# ROADMAP — 产品回顾后的行动计划(2026-07)

> 来源:2026-07 全量产品回顾(四视角评审 + 实测证据)。
> **核心结论:代码已跑到数据前面——瓶颈、风险、下一波价值全部在数据运营侧。**
> 分析师裁决基线:「诚实的晨会看板,尚非拍板工具」;跨过门槛靠 P0–P2。
>
> 分工约定:「🧑 用户」= 需要用户动手(拉数/丢财报/跑 skill);「🤖 团队」= agent 直接做。
> 数据入库一律走:产出规格 JSON → `python3 tools/merge.py` → validate 0 ERROR → build(失败自动回滚)。

---

## P0 · 完成口径换血(消灭混合态)——当前最大可信度漏洞

背景:已拍板「全量迁真实」,但目前**仅 tsmc/FY2025 是财报官方口径**,其余 12 家仍是情景/混合来源。
混合态每停留一天,核心视图(迁移图/AI 池/龙头占比)可信度打一天折扣。

- [ ] **D1 · 12 家迁真实口径**(🧑 财报 PDF 丢进来 或 Tiger skill 按 `DATA-SPEC-tiger.md` 吐 JSON;🤖 提取/对账/merge)
  - 批次优先级:①云四家 google/microsoft/amazon/oracle(10-K 顺带分部经营利润,喂 D4)→ ②存储 samsung/micron/skhynix + 设计 nvda/broadcom → ③其余 asml/softbank/tencent
  - 每家要求:actual 年(营收/毛利率/经营利润/净利/capex/CFO)+ 平台/分部拆分 + 来源标注;**整批换,不留混合**
- [ ] **D2 · TSMC FY2024 官方修正**(🧑 需 FY2024 年报/20-F 的平台拆分;🤖 提取)
  - 已知偏差:官方 rev 90.08 / ni 36.52 vs 库内 88.268 / 35.327;上次因缺 FY2024 平台拆分被对账闸门正确拦回
- [ ] **D3 · quote 快照刷新**(🧑 Tiger `get_financial_daily`;🤖 merge)
  - 现状停在 as_of 2026-06-26;13 家市值/价格/净债务分量刷到同一交易日

## P1 · 点亮 sourced + TTM 补齐——让头牌数字站上硬数据

背景:首页 $291B AI 池 **100% proxy**(营收占比冒充利润占比,零 sourced);
而 google/microsoft/amazon 的**分部经营利润已在库里**(seg_profit=yes),材料早有、只差用起来。

- [ ] **D4 · 云厂 AI 归因 proxy→sourced**(🤖 架构师定口径 + 工程师落地;🧑 确认口径)
  - 用已录云分部经营利润推 `ai_profit_share`(带 `ai_share_source`,data_status=derived/estimate)
  - 先 google/microsoft/amazon 三家;oracle 分部利润未披露(seg_profit=no)→ 留 proxy
- [ ] **D5 · 季度净利补齐 6 家**(🧑 Tiger `get_financial_report` period=季度,最近约 8 季;🤖 merge)
  - 缺口:softbank/tencent/google/microsoft/amazon/oracle → TTM 柱云环节现为 0
  - 软银收益最低(净利受投资损益主导)可最后/放弃,规格已注明

## P2 · 喂前瞻——从看板跨到决策工具的门槛

背景:前瞻 PE 空盒子已建好(schema/validate/Selector/UI 全就绪),**全空**;
分析师头号诉求:「不做前瞻,comps 对我只是起点;做了,我天天开它。」

- [ ] **D6 · consensus EPS 灌入**(🧑 Tiger `get_corporate_earnings_calendar` 预期 EPS;🤖 merge)
  - 字段:forecast 年 `consensus_eps_value` + `consensus_eps_currency` + `consensus_eps_source`(**data_status 必为 consensus**)
  - 宁缺毋滥:有清晰一致预期的大票先上(nvda/云四家/tsmc),拿不到的诚实留空

## P3 · 工程加固(小而防烂,🤖 团队直接做,不依赖数据)

- [ ] **E1 · validate.py TODAY 去硬编码**——现钉死 2026-06-30,随真实时间流逝新鲜度检查会失真;改真实日期(一行,防「悄悄坏」)
- [ ] **E2 · 测试拆分:逻辑回归 vs 数据快照**——现每次数据更新都要手改硬编码断言(TSMC 已痛过);拆开后数据刷新不再碰测试文件,是 D1 批量换血的前置减摩
- [ ] **E3 · FX 口径统一**——各公司历史条目汇率来源异质(都有标注、不算错);随 D1 换血顺手统一为「公司隐含均汇优先,否则期间均汇,来源注明」

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
