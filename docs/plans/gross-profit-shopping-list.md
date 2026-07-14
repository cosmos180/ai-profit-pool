# gross_profit 采购单 — B2 数值行整迁的硬门控(🧑 Dayu/PDF 通道)

> 背景:B2 ADR(`broad-migration-b2-annual-views.md`)判定年度视图数值行整迁**门控在
> annual periods 的 `gross_profit` 补录**——现状 annual actual periods 的毛利全 null,
> 硬迁会让毛利/毛利率整列消失。本单按 2026-07-14 库内实跑普查生成。
> 规则:用财报**真实披露值**;单位 USD bn(非美元按该期库内 `fx_to_usd` 口径换算并注明);
> 走 merge.py **仅含 periods 的部分对象**增量并入,不改 `years[]`(year schema 没有 gross_profit);
> `years[].gross_margin` 已有值只作交叉校验:|gp/rev − gm| ≤ 0.001(validate 不强制,采集端自检)。
> 库内共 41 个 annual null:本单要求补 38 个,Amazon 3 个按既定政策豁免。

## 口径分级(采集前先按此判定,不确定的在产物里注明)

| 级 | 判定 | data_status |
|---|---|---|
| A | 损益表**直接呈列 Gross profit/Gross margin 小计** | official |
| B | 无毛利小计,但单一 CoR 或完整直接业务成本集与 S&M/R&D/G&A 清晰分列 → gp = revenue − Σdirect costs | derived,label 写明完整换算式 |
| C | 项目既定政策豁免:即使可由 revenue−cost of sales 重构也不写入(当前仅 amazon,先例已入 SKILL.md §6) | **明确 null 豁免,不采** |

## 逐家清单(annual 必做;quarter 顺手做,不阻塞 B2)

| 公司 | 级 | 来源表 | annual 缺口 | quarter 缺口(顺手) |
|---|---|---|---|---|
| microsoft | A(income statement 有 Gross margin 行) | 10-K/10-Q | fy2023/24/25-annual | fy2024q2..fy2026q2 共 7 季 |
| nvda | A | 10-K/10-Q | fy2024/25/26-annual | fy2026q1 |
| micron | A | 10-K/10-Q | fy2023/24/25-annual | fy2025q1..fy2026q2 共 5 季 |
| broadcom | A | 10-K/10-Q | fy2023/24/25-annual | fy2025q1,fy2025q2,fy2026q1 |
| arm | A | 20-F | fy2024/25/26-annual | — |
| tsmc | A(损益表毛利行;USD 用各期库内隐含均汇口径) | 20-F/6-K | fy2023/24/25-annual | — |
| asml | A(EUR;按各期库内 fx 口径) | 20-F/6-K | fy2023/24/25-annual | — |
| samsung | A(손익계산서 매출총이익;KRW 按各期库内 fx) | 사업보고서/분기보고서 | fy2024/25-annual | 2026q1 |
| skhynix | A(同上) | 사업보고서 | fy2023/24/25-annual | 2025q1..2026q1 共 4 季 |
| tencent | A(IFRS 毛利行;RMB 按各期库内隐含汇率) | HKEX 年报/业绩公告 | fy2023/24/25-annual | — |
| softbank | **A**(IFRS 损益表直接呈列 Gross profit;投资收益在其后单列,不污染该原始事实) | Financial Report / Consolidated Statement of Profit or Loss | fy2023/24/25-annual | 已齐(FY2025 Q1–Q3 已录 official gross_profit) |
| google | **B**(无小计;Cost of revenues 单列) | 10-K/10-Q | fy2023/24/25-annual | 2023q3..2025q3 共 7 季 |
| oracle | **B**(无小计;`total revenues − cloud and software − hardware − services expenses`,三条直接业务成本与 S&M/R&D/G&A 分列) | 10-K/10-Q Consolidated Statements of Operations | fy2024/25/26-annual | fy2024q2..fy2026q2 共 7 季 |
| amazon | **C 豁免**(不披露传统 gross profit,先例已立) | — | 保持 null | 保持 null |

复核锚:[SoftBank Financial Report 2025 p.4](https://group.softbank/media/Project/sbg/sbg/pdf/ir/financials/annual_reports/financial-report_fy2025_en.pdf)直接呈列 Net sales / Cost of sales / Gross profit,投资收益在其后另列;[Oracle FY2026 10-K](https://www.sec.gov/Archives/edgar/data/1341439/000119312526277521/orcl-20260531.htm)的 Consolidated Statements of Operations 将三条直接业务成本与 S&M/R&D/G&A 分列,因此只允许按上述完整公式标 `derived`,不得把 segment 表的非 GAAP/未分配口径混入。

## 自检(产物 _selfcheck)
- A 级:源币 raw gp 与 filing 呈列值逐字一致;存储的 USD gp = raw gp ÷ fx_to_usd(4 位);gp/revenue 与 years[] 既有 gross_margin(如有)差 ≤ 0.001;
- B 级:revenue 与全部 direct-cost 原文值 + 完整换算式;单一 CoR 时 label 写「derived = revenue − cost of revenues」,多成本行(Oracle)逐项列出,不得用 segment 表的未分配口径;
- 非美元:注明所用 fx 与库内该期 `fx_to_usd` 一致。

## 完成判据(B2 解锁条件)
13 家(A 11 + B 2)的 annual actual periods `gross_profit` 全部非 null、Amazon 保持政策豁免 →
B2 D2/D3(年度数值行整迁 + 桑基)开工;Amazon 毛利列显示诚实留空。
