# 广口径迁移 · 第一批「估值链」ADR

> 状态：**已落地**（2026-07-08 工程实现；四门禁全绿·快照零漂移）。作者：架构师。日期：2026-07-08。
> 落地记录：`data-module.js` 新增 `latestActualAnnual`/`latestCashActualAnnual`，`pe/ps/evSales/fcfYield` 内部换源（签名/null 语义/caveat 三态不变）；`validate.py` 新增「双写一致性」硬 ERROR 兜底；`test-logic.js` 补 periods 夹具 + periods-wins/诚实退化用例。回退策略采「纯 periods 无运行时回退」（决策点 1 前者），validate 规则为硬 ERROR（决策点 2），保留 `latestCashActualAnnual` 现金年阶梯（决策点 3）。
> 上游：`docs/plans/period-base-refactor.md`（Phase 6 final 已完成）、`docs/ROADMAP.md`（E4 + 过渡期双写规则）。
> 范围：只把**估值倍数的分母**从 legacy `years[]` 切到 `periods[]` 的最新 actual annual。**不改任何生产代码**——本文只给契约与边界，落地交工程师。
> 迁移顺序（用户已拍板）：**估值链 →** 年度视图/桑基 → AI 池 → 前瞻。本批只做第一段。

---

## 一句话架构判断

估值链（`pe/ps/evSales/fcfYield`）当前经 `latestActual(c)`（`years[]` 最新 actual 年）取分母；在**双写时代**，每家的「最新 actual 年」与「最新 actual annual period」是同一事实的两份拷贝，**实测 14 家 × 4 倍数 = 56/56 全部 bit-identical**。因此本批是一次**零行为变化的数据源替换**：把四个倍数与 `fcfYield` 的现金年选取内部改读 periods，视图层零改动。分歧风险不在数值，而在「无 annual period 时的诚实退化」与「双写纪律靠谁守」——这决定回退策略。

---

## 背景

- **现状（data-module.js）**：
  - `pe(c)/ps(c)/evSales(c)` 分母 = `latestActual(c).net_income / .revenue`；
  - `fcfYield(c)` 分子 = `fcf(latestCashYear(c))`，`latestCashYear` = 最新 actual 年里**带 cfo/capex** 的那一年（现金字段常滞后 headline 年）；
  - `ev(c)` = `marketCap + netDebt`，均来自 `c.quote`（**与年度事实无关，不迁**）；
  - `valuationCaveat(c,key)` 读 `c.valuation_caveat`（**公司级，不读 years，不迁**）；
  - `stageValuationRel(c,key)` 与 `homeMetric(c,key)` 只是 `pe/ps/evSales/fcfYield` 的**消费方**——四倍数一迁，它们自动跟随，无需单独改。
- **periods 侧已就绪**：`periods(c)`、`actualPeriods(c)`、`PERIOD_METRICS=[revenue,op_income,net_income,cfo,capex]`、`fiscalYearFromPeriods` 等；annual period 形状含 `fiscal_year / revenue / net_income / op_income / cfo / capex / period_end / currency / fx_to_usd / segments`。
- **双写规则（ROADMAP D5）**：年度 actual 事实**同时**写 `periods[]` annual 与 legacy `years[]`（按 `period_end_iso` 增量）；季度只写 periods。本批正是要让估值链**不再依赖** `years[]` 那一半。

---

## 决策

### D1 — 新增 selector：`latestActualAnnual(c)`（periods 侧「最新实际年」）

**契约**

```
latestActualAnnual(c)
  → 最新（按 period_end 升序取末位）满足 kind==="annual" && status==="actual" 的 period 对象
  → 无此类 period 时返回 null（不回退 years，不借季度合成）
```

- 复用现有 `periods(c)` 的排序（已按 `period_end` 升序、丢弃无法解析日期者）。
- 返回**原始 period 对象**，字段对应关系（与 `latestActual` 的 year 对象逐字对齐）：

  | 消费点 | year 字段（旧） | annual period 字段（新） |
  |---|---|---|
  | `pe` 分母 | `latestActual(c).net_income` | `latestActualAnnual(c).net_income` |
  | `ps` / `evSales` 分母 | `latestActual(c).revenue` | `latestActualAnnual(c).revenue` |
  | FY 标识 | `.fy`（如 `"FY2026"`） | `.fiscal_year`（同值 `"FY2026"`） |

- **是否跟随 segments / is_ai：否。** 估值四倍数根本不读 segments/is_ai——`aiShare` 属 **AI 池链**（第三批），本批绝不顺手迁 `aiShare` 的年份锚（它仍读 `latestActual(c)` 的 `is_ai` 分部）。栅栏见 §范围栅栏。

### D2 — 新增 selector：`latestCashActualAnnual(c)`（`fcfYield` 专用现金年）

`fcfYield` 的语义**不是**「用最新年」而是「用最新**带现金字段**的年」（`latestCashYear` 的现有意图：capex/cfo 滞后 headline 年）。periods 侧必须保留同款回退，否则会在某公司最新 annual 缺 cfo/capex 时静默变 null（行为漂移）。

```
latestCashActualAnnual(c)
  → 从 annual actual periods 里，自新到旧，第一个 cfo!=null || capex!=null 者
  → 无 → null
fcfYield 分子 = fcf(latestCashActualAnnual(c))   // fcf(p)=p.cfo-p.capex，复用现有 fcf()
```

实测 14 家：最新 annual actual 都带 cfo/capex，故 `latestCashActualAnnual == latestActualAnnual`，无回退触发；但契约必须显式保留该阶梯，防未来某家最新 annual 只录 headline。

### D3 — 四倍数与两消费方内部换源，签名/返回形状不变

`pe/ps/evSales/fcfYield` 的函数签名、null-safe 语义、`valuationCaveat` 三态处理（`na→null` / `distorted→照常出值` / `ok`）**全部不变**，仅把 `this.latestActual(c)` 换成 `this.latestActualAnnual(c)`、`this.latestCashYear(c)` 换成 `this.latestCashActualAnnual(c)`。

- `ev(c)` / `marketCap` / `netDebt` / `valuationCaveat`：**不动**（quote 与 caveat 均非 years 派生）。
- `stageValuationRel` / `homeMetric` 的估值分支：**不动**（透传四倍数，值不变则 cohort 成员、中位数、relative 全不变）。
- `homeMetric` 的 `revenue/netIncome/netM` 分支仍读 `latestActual`——**那是年度表/首页 headline 口径，属第二批（年度视图），本批不迁**。只迁 `pe/ps/evSales/fcfYield` 四个 key。

### D4 — 视图层：零改动

`web/` 组件经 `web/src/lib/data.js` 拿 `Selectors.pe/ps/evSales/fcfYield/stageValuationRel/homeMetric`；这些名字与返回形状不变，**视图零改动、零重构**（不变量 5 天然满足）。`lib/data.js` 适配壳也无需动（只透传具名导出）。

---

## 理由

1. **可替换性最高、失真风险最低**：双写保证两侧同值，实测 56/56 bit-identical（见下表），这是 14 家里**唯一**能做到「换源即零行为变化」的链路，正适合当广口径迁移的第一张多米诺。
2. **保内部意图**：`fcfYield` 的「最新现金年」不是实现细节而是口径（现金字段滞后），故用 D2 显式镜像，而非偷懒改成「最新 annual」。
3. **不越界**：estimate 类判断（caveat）、市场快照（quote）本就不在 years，天然留在原层；segments/is_ai/aiShare 明确划给后续批次，避免蔓延污染。
4. **诚实优先**：无 annual period 一律 null，绝不回退 years「补齐」——符合不变量「留空也比填错好」。

---

## 平价验收（硬门禁）— 14 家逐家实测

口径：`marketCap/netDebt/ev/valuationCaveat` 两侧共用（不变）；分母 years 侧 = `latestActual`，periods 侧 = `latestActualAnnual`（`fcfYield` 用各自的现金年选取）。相等判据 `|a−b|<1e-9`。脚本：`scratchpad/parity.cjs`（不入库），实跑 `companies.json` 当前快照。

| 公司 | pe (years=periods) | ps | evSales | fcfYield | FY(年/期) | 全等 |
|---|---|---|---|---|---|---|
| nvda | 38.6345 | 21.4875 | 21.2370 | 0.0208 | FY2026/FY2026 | ✅ |
| samsung | 43.0439 | 5.7110 | 5.3804 | 0.0171 | FY2025/FY2025 | ✅ |
| broadcom | 76.3210 | 27.6269 | 28.4033 | 0.0152 | FY2025/FY2025 | ✅ |
| softbank | null (pe=na) | 4.2232 | 6.7955 | null (fcf=na) | FY2025/FY2025 | ✅ |
| micron | 124.1363 | 28.3589 | 28.4940 | 0.0035 | FY2025/FY2025 | ✅ |
| skhynix | 40.9177 | 18.0892 | 17.7560 | 0.0145 | FY2025/FY2025 | ✅ |
| tsmc | 34.5046 | 15.5612 | 14.9275 | 0.0172 | FY2025/FY2025 | ✅ |
| asml | 62.5345 | 18.3946 | 18.2180 | 0.0163 | FY2025/FY2025 | ✅ |
| tencent | 13.7673 (caveat distorted，仍出值) | 4.7514 | 4.6090 | 0.0511 | FY2025/FY2025 | ✅ |
| google | 33.8957 | 11.1212 | null (netDebt 缺→ev null) | 0.0164 | FY2025/FY2025 | ✅ |
| microsoft | 28.2819 | 10.2228 | null (ev null) | 0.0249 | FY2025/FY2025 | ✅ |
| amazon | 34.1187 | 3.6963 | null (ev null) | 0.0029 | FY2025/FY2025 | ✅ |
| oracle | 23.5716 | 6.0573 | 7.5070 | −0.0581 | FY2026/FY2026 | ✅ |
| arm | 376.1062 | 69.1057 | 68.3738 | 0.0029 | FY2026/FY2026 | ✅ |

**结论：56/56 metric cells bit-identical，14/14 家逐家全等，零不一致。**

- 三处 `null`（softbank pe/fcfYield、google/microsoft/amazon evSales）两侧同为 null，且**根因都不在分母源**：softbank 是 `valuation_caveat`（pe/fcf_yield=na）在读年份之前就短路；google/msft/amazon 是 `net_debt` 缺失 → `ev=null`（quote 侧，与迁移无关）。切换数据源**不改变**这些 null。
- tencent pe caveat=`distorted` 仍出值、softbank ps/ev_sales=`distorted` 仍出值——`distorted` 语义两侧一致保留。
- 每家「最新 actual 年 FY」= 「最新 actual annual period FY」，逐家对齐（双写保证）。这正是全等的机制根因：periods annual 与 years 是同一年度 actual 事实的两份拷贝，`revenue/net_income/cfo/capex` 逐字段相同。

---

## 回退策略（关键决策点）

**建议：纯 periods，无运行时 years 回退；由 validate.py 新增一条「双写一致性」不变量在闸门处兜底。** 与 Phase 6 final 的「过渡回退 + 计数 + 达标后删」**刻意分道**，理由如下。

### 为什么不照抄 Phase 6 final 的过渡回退

Phase 6 final 之所以用过渡回退 + `legacy_fallback` 计数，是因为**当时 TTM 覆盖不完整**——periods 季度尚未补齐，`legacy_fallback` 真实 > 0，回退是**承重的**。本批的处境相反：

- **实测 56/56 全等、14/14 家都已双写 annual period**——若加运行时回退，它的计数**从第一天就是 0**，是一段**出生即死代码**。
- 一段永不触发的 `years` 回退分支是**负债不是保险**：它会把「某家漏了 annual 双写」这种数据回归**静默吞掉**（偷偷借 years 出值），而不是让它暴露。这违背「留空也比填错好」——我们宁可让漏写的公司该倍数变 null 并在闸门报错，也不要它看起来正常。

### 替代兜底：把双写纪律钉在闸门（validate.py）

双写目前是**人工纪律**（merge 时手动同写），schema/validate **未强制**。因此把保证从「运行时静默回退」移到「校验期显式报错」更符合分层：

> **新增 validate 规则（B1 配套）**：对每家 `status=populated` 公司，每条 `years[]` 中 `status=actual` 的记录，必须存在一条 `periods[]` 中 `kind=annual && status=actual` 且 `fiscal_year == years.fy`（或按 `period_end_iso`/`period_end` 年份对齐）的 period；且两者 `revenue/net_income` 在容差内相等。缺失或不一致 → `ERROR`。

这样「无 annual period 时估值倍数返回 null」在**构造上安全**（validate 已挡住「有 years actual 却无对应 annual」的情形），运行时无需 legacy 分支。

### 若主会话/用户仍偏好过渡回退（备选方案）

保留 `latestActualAnnual` 为主、`latestActual` 为副的运行时回退 + 一个 audit-only 计数 selector（如 `valuationSourceAudit(c)` 返回 `{basis:"periods"|"legacy_years", ...}`），门禁「计数持续 0 后删除」照 Phase 6 先例。代价：多一段过渡代码 + 一次后续删除 PR。**我不推荐**，因为它对一个已 56/56 全等的链路只增维护面、不增安全。

---

## honesty 语义

- **无 annual period / 缺指标**：`latestActualAnnual(c)` 返回 null → `pe/ps/evSales` 返回 null（**不借 years 补**）；某指标缺失（如 annual 只录 headline 没 cfo/capex）→ `fcfYield` 经 `latestCashActualAnnual` 找更早的现金年，仍无 → null。**一律留空，不伪造、不回退。**
- **`valuationCaveat` 语义不变**：`na→null`、`distorted→出值供视图警示`、`ok→正常`。caveat 读 `c.valuation_caveat`（公司级），与数据源切换正交，本批不触碰。
- **`stageValuationRel` cohort 语义不受影响**：cohort 成员资格 = `_valComparable`（caveat 非 na/distorted 且值非 null）。值全等 → 成员集、`cohortN`、`median`、`relative`、`insufficient` 全部逐位不变。实测四倍数值不变即证明 cohort 输出不变。软银（pe/fcf_yield=na、ps/ev_sales=distorted）、腾讯（pe=distorted）继续被排除在对应 cohort 外，语义不变。

---

## 测试与回滚计划

### test-logic.js（合成用例，不因数据刷新而改）

现有估值合成用例（`test-logic.js` L208–244）全部用 `years[]` 构造（`vCompany/noQuote/noDenom/fcOnly`）。迁移后这些公司对象**没有 `periods[]`** → `latestActualAnnual` 返回 null → 断言 `pe==10` 会变红。配套改动：

1. **改造合成夹具**：给每个估值夹具补一条等价 `periods[]` annual actual（`kind:"annual", status:"actual", fiscal_year, revenue, net_income, cfo, capex, period_end, currency:"USD", fx_to_usd:1, sources:[...]`），数值与原 `years[]` actual 年一致。断言期望值**保持不变**（10 / 2 / 0.1 等）。
2. **新增诚实退化用例**：
   - `periods` 缺 annual（只有季度或空）→ `pe/ps/evSales` 断言 null；
   - annual 缺 cfo/capex 但更早 annual 有 → `fcfYield` 用更早现金年（验证 `latestCashActualAnnual` 阶梯）；
   - annual 全缺现金 → `fcfYield` null。
3. **`stageValuationRel` cohort 用例**：若已有，同样把夹具补 `periods` annual，期望值不变。

> 注：合成夹具补 `periods` 是**测试内构造**，不进 `companies.json`，不违反「不改数据」。

### test-snapshot.js（真实数据快照）

**预期零变化。** 56/56 全等意味着 `pe/ps/evSales/fcfYield/stageValuationRel/homeMetric` 对真实 14 家的输出逐位不变，快照 `.expected.json` **不应产生 diff**。若出现任何 diff → 说明某家 annual period 与 years 不同步（数据 bug），应先修数据/补双写，而非更新快照。这也顺带成为迁移正确性的活体验收。

### ESLint 不变量闸门

- **现有闸门够用范围**：`web/eslint.config.js` 的 `no-restricted-imports` 钉的是「组件不得直连 data-module.js/companies.json」——那是**视图层**边界，本批视图零改动，闸门无需动。
- **是否需要「禁止新代码读 years[]」规则**：现有 ESLint **管不到 `data-module.js` 内部**（它是 CJS、不在 web/ lint 范围），且 `years[]` 在本批之后仍**合法服务**年度视图/AI 池/前瞻链（那三批尚未迁）。因此**不宜**加一条全局「禁读 years[]」——会误伤仍合法的三条链。
  - **建议替代**：不加 ESLint 规则，改用**函数级约定 + 注释锚点**——在 `pe/ps/evSales/fcfYield/latestActualAnnual` 上标注 `// B1-migrated: periods-only, 禁止改回 latestActual`，并把「估值链禁读 years」列入 §review 清单。真正的机器化「禁读 years」闸门留到**四条链全迁完**、`years[]` 整体退役时再一次性上（届时可用 grep-based CI 检查或把 years 访问收敛到单一 deprecated helper）。

### 回滚

单 PR、纯 `data-module.js` 内部改动 + 测试夹具 + 一条 validate 规则。回滚 = `git revert` 该 PR，四倍数即刻回到 `latestActual` 口径，视图与数据零残留（无 schema 变更、无 companies.json 变更）。

---

## 范围栅栏（本批**不动**）

| 不动项 | 归属批次/原因 |
|---|---|
| `homeMetric` 的 `revenue/netIncome/netM` 分支 | 年度视图/首页 headline → **第二批** |
| 年度表、`incomeFlow`、桑基 | 第二批（年度视图/桑基） |
| `aiShare`、`profitPoolAI`、segments/is_ai 归因、`aiWeightedNetIncome` | **第三批（AI 池）**——`aiShare` 仍读 `latestActual` 的 is_ai 分部，本批绝不迁 |
| `Migration` 图、`profitPoolTTM` | 已是 Phase 6 final periods 口径 / 属年度链，不在估值链 |
| `forwardPE`、`consensus_eps_*`、`forecastYear` | **第四批（前瞻）**——前瞻读 forecast 年，本批不碰 |
| `quote`（marketCap/netDebt/ev）、`valuation_caveat` | 非 years 派生，天然不迁 |
| schema.json 的 `years[]`/`periods[]` 结构 | 无字段增删（只加一条 validate 一致性规则，不改 schema） |

---

## 需要用户/主会话拍板的决策点

1. **回退策略（核心）**：采纳「**纯 periods 无运行时回退 + validate.py 双写一致性 ERROR 兜底**」（架构师推荐），还是照 Phase 6 先例上「过渡回退 + 计数 + 达标后删」？——鉴于实测 56/56 全等、14/14 已双写，推荐前者（后者会是出生即死代码 + 静默吞回归）。
2. **validate 一致性规则的严格度**：新规则是**硬 ERROR**（缺 annual double-write 即 fail build），还是先 WARN 一轮观察？推荐直接 ERROR——双写是既定纪律，且当前 14 家全通过，无迁移摩擦。
3. **`fcfYield` 现金年阶梯**：确认保留 `latestCashActualAnnual` 的「回退到更早带现金的 annual」语义（与现 `latestCashYear` 对齐），而非简化为「只用最新 annual」。推荐保留（否则未来某家最新 annual 只录 headline 时会静默变 null）。

以上三点拍板后，本批即可交工程师落地：改 `data-module.js`（+2 selector、4+2 处换源）、改 `test-logic.js`（夹具补 periods + 新增退化用例）、加 1 条 validate 规则；快照预期零 diff。落地后跑：`python3 validate.py companies.json schema.json` · `bun test-logic.js` · `bun test-snapshot.js` · `cd web && bun run build`。
