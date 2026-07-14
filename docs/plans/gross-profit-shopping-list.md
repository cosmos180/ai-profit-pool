# gross_profit 采购单 — B2 数值行整迁的硬门控(🧑 Dayu/PDF 通道)

> 背景:B2 ADR(`broad-migration-b2-annual-views.md`)判定年度视图数值行整迁**门控在
> annual periods 的 `gross_profit` 补录**——现状 annual actual periods 的毛利全 null,
> 硬迁会让毛利/毛利率整列消失。本单按 2026-07-14 库内实跑普查生成。
> 规则:用财报**真实披露值**;单位 USD bn(非美元按该期库内 `fx_to_usd` 口径换算并注明);
> 走 merge.py periods 部分对象增量并入;年度事实同时双写 `years[]`(gross_margin 已有的年
> 与新 gross_profit 必须自洽:|gp/rev − gm| ≤ 0.001,validate 不强制但采集端自检)。

## 口径分级(采集前先按此判定,不确定的在产物里注明)

| 级 | 判定 | data_status |
|---|---|---|
| A | 损益表**直接呈列 Gross profit/Gross margin 小计** | official |
| B | 无小计,但 Cost of revenue(s)/Cost of sales 单列 → gp = revenue − CoR(两个披露值的恒等式) | derived,label 写明换算式 |
| C | 不披露传统毛利概念(amazon 先例已入 SKILL.md §6;softbank IFRS 投资控股口径) | **明确 null 豁免,不采** |

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
| google | **B**(无小计;Cost of revenues 单列) | 10-K/10-Q | fy2023/24/25-annual | 2023q3..2025q3 共 7 季 |
| oracle | **B**(无小计;分项成本单列——若判定分项口径不构成干净 CoR,降 C 豁免并注明) | 10-K/10-Q | fy2024/25/26-annual | fy2024q2..fy2026q2 共 7 季 |
| amazon | **C 豁免**(不披露传统 gross profit,先例已立) | — | 保持 null | 保持 null |
| softbank | **C 豁免**(投资控股,毛利概念失真) | — | 保持 null | 保持 null |

## 自检(产物 _selfcheck)
- A 级:抄录的 gp 与 filing 呈列值逐字一致;gp/revenue 与 years[] 既有 gross_margin(如有)差 ≤ 0.001;
- B 级:revenue、CoR 两条原文值 + 换算式;label 注明「derived = revenue − cost of revenues」;
- 非美元:注明所用 fx 与库内该期 `fx_to_usd` 一致。

## 完成判据(B2 解锁条件)
12 家(豁免 2 家外)的 annual actual periods `gross_profit` 全部非 null → B2 D2/D3(年度数值行
整迁 + 桑基)开工;毛利列在豁免公司显示诚实留空。
