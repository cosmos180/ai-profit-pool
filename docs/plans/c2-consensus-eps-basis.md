# C2 · consensus EPS 基准披露（GAAP / Non-GAAP）

> 状态：已实现（Issue #35，源自 Discussion #34 分析师 DoD 复评 C2 + 维护者拍板 C2 → C1 → C3）
> 风险样本：oracle FY2027E `consensus_eps_value = 8.05` 隐含净利 ≈$23B（指向 Non-GAAP），
> 与 GAAP 净利 $19.02B 不同——而前瞻 PE 是 comps **默认排序锚**，此前与 GAAP trailing
> 同表混排且零标注。混用 GAAP trailing 与 Non-GAAP forward 是 comps 头号口径陷阱。

## 核心原则：标注而非删除

现有 consensus 是真实外部一致预期，缺陷在 **basis 未披露**，不在数值本身：

- basis 未知时**保留**前瞻 PE 数值、排序与覆盖；
- 显示「基准未标注」警示（公司页前瞻 PE 卡 chip + comps tooltip）；
- **不清空、不猜测、不把 Non-GAAP 改写成 GAAP**；
- Issue B（13 家 consensus 质量 pass：新采 5 家 + 回补 8 家 basis 取证）完成后消除警示。

## 契约

`schema.json` forecast year 增可选字段：

```jsonc
"consensus_eps_basis": {"enum": ["gaap", "non_gaap", "unlabeled"]}
```

- `gaap` / `non_gaap`：**来源明确说明**才可标（取证纪律，与 provenance 同族）；
- `unlabeled`：来源未说明或无法可靠判定；
- **缺失回退**：有 `consensus_eps_value` 但字段缺失 → 消费侧等价视为 `unlabeled`（旧数据零破坏）；
- basis 只做披露，**绝不门控或改变 `Selectors.forwardPE` 的数值计算**。

## 消费面

- `Selectors.consensusEpsBasis(c)`：null-safe——仅当 forecast 年 `consensus_eps_value` 非空才产生
  basis 状态（无 consensus / 无 forecast → null）；缺失/非法值回退 `unlabeled`；
- `CONSENSUS_BASIS_LABEL` 词典：gaap→GAAP · non_gaap→Non-GAAP · unlabeled→基准未标注；
- comps：**仅前瞻 PE 出值行**（ok/distorted）的 cell 携带 `basis/basisLabel/basisWarn` 并把披露文案并入
  tooltip note；blank/na 行不带（原 note 不被改写）；`caveatNote` 增 trailing-GAAP vs forward-consensus
  基准差异提示；value/sortKey/state/covered 全部零变化；
- 公司页前瞻 PE 卡：basis chip（gaap/non_gaap 中性灰、unlabeled 用 est 警示色系），title 说明口径含义；
  前瞻 PE 本就 blank 的卡不显示 chip。

## validate 两阶段门控

| 阶段 | 规则 | 级别 |
|---|---|---|
| **Phase 1（本批）** | `consensus_eps_value` 非空且 basis 缺失或 `unlabeled` → WARN；`gaap/non_gaap` → INFO | WARN |
| Phase 2（Issue B 取证完成后另批） | 上述 WARN 升 ERROR | ERROR |

红线：本批不得提前升 ERROR；**不得为清零 WARN 猜测填充 basis**；非法枚举由 schema 拒绝。
当前 8 家 consensus 全部未取证 → 预期恰好 8 条 WARN，这是诚实状态而非缺陷。

## 与 Issue B / C3 的衔接

- Issue B 采集模板必须带 `consensus_eps_basis` 取证要求（供应商对基准的原文说明进 source label）；
  币种与 `quote.price_currency` 同轴；来源含供应商 + as-of 日期；
- C3（前瞻 PE 同环节相对位，覆盖 ≥3 家才点亮）搭 Issue B 落地批。
