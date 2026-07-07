#!/usr/bin/env node
/* =====================================================================
   tools/gap-report.cjs — fallback retirement 季度原子「购物清单」
   ---------------------------------------------------------------------
   对每家 ttmNetIncomeUnified(c).basis !== "periods" 的公司,输出把 TTM 从
   legacy_fallback / null 点亮成 periods 口径所需的**精确季度清单**,给出两条路线:
     · 路线 A(直接):最新四个连号日历季全为 actual —— 列缺哪些季(目标 period_end + fiscal 标签);
     · 路线 B(implied):最新财年 annual + Q1–Q3 —— 缺哪几季,implied Q4 自动派生即点亮。
   复用真实 selector(data-module.js 的 impliedQ4 / _quartersWithImpliedQ4 / ttmFromPeriods),
   路线可行性用「注入合成季 → 跑 ttmFromPeriods」模拟确认(不写盘,纯只读报告)。
   算不存、绝不臆造数字:只报「缺哪些季、目标日期、走哪个通道」,不编造财务值。
   ===================================================================== */
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { Selectors: S } = require(path.join(ROOT, "data-module.js"));
const db = require(path.join(ROOT, "companies.json"));

/* 采集通道:哪些公司 Dayu(SEC 10-Q/6-K)可得,哪些需丢 PDF 人工提取。 */
const CHANNEL = {
  nvda:      "Dayu (SEC 10-Q)",
  broadcom:  "Dayu (SEC 10-Q)",
  tsmc:      "Dayu (SEC 20-F/6-K)",
  asml:      "Dayu (SEC 20-F/6-K)",
  samsung:   "需丢 PDF (KRX 季报)",
  skhynix:   "需丢 PDF (KRX 季报)",
  tencent:   "需丢 PDF (HKEX 季报/中报)",
  softbank:  "需丢 PDF (TSE 季报)",
  arm:       "需丢 PDF/Tiger (20-F,非 Dayu SEC 清单)",
};

const DAY = 86400000;
const parseDate = (iso) => S._parseDate(iso);
const isoOf = (t) => (t == null ? null : new Date(t).toISOString().slice(0, 10));
const qidx = (p) => S._quarterIndex(p);
const fq = (p) => `${p.fiscal_quarter || "?"} ${p.fiscal_year || "?"}`;
const cyLabel = (idx) => `CY${Math.floor(idx / 4)}Q${(idx % 4) + 1}`;

/* 年报末回退 m 个月(保留日),供估算 fiscal Qn 的目标 period_end。 */
function monthsBackISO(iso, m) {
  const t = parseDate(iso);
  if (t == null) return null;
  const d = new Date(t);
  d.setMonth(d.getMonth() - m);
  return d.toISOString().slice(0, 10);
}

/* 从年报期把一个财年拆成 4 个 fiscal 季的「期望网格」,再用真实 actual 季覆盖。
   关键:fiscal Q4 的日历季索引 = 年报末所在日历季;Qn 索引 = Q4索引 − (4−n) —— 保证四季**连号**
   (÷4 中点估算会因边界漂移误判日历季,故改用年报末锚定的整季平移)。
   返回 [{fiscal_year, fiscal_quarter, idx, cy, est_end(估算 period_end), actual(真实季或 null)}] */
function quarterGrid(c) {
  const periods = S.periods(c);
  const annuals = periods.filter(p => p.kind === "annual" && p.status === "actual" && p.fiscal_year);
  const actuals = periods.filter(p => p.kind === "quarter" && p.status === "actual");
  const actualByFyQ = {};
  for (const p of actuals) if (p.fiscal_year && p.fiscal_quarter) actualByFyQ[`${p.fiscal_year}|${p.fiscal_quarter}`] = p;
  const grid = [];
  for (const a of annuals) {
    const q4idx = qidx({ kind: "quarter", calendar_year: a.calendar_year, calendar_quarter: S._calQuarterOf(a.period_end) })
      ?? (a.calendar_year != null ? a.calendar_year * 4 + (Number((S._calQuarterOf(a.period_end) || "Q1").slice(1)) - 1) : null);
    for (let n = 1; n <= 4; n++) {
      const actual = actualByFyQ[`${a.fiscal_year}|Q${n}`] || null;
      const idxProbe = actual ? qidx(actual) : (q4idx != null ? q4idx - (4 - n) : null);
      const est_end = actual ? actual.period_end : monthsBackISO(a.period_end, (4 - n) * 3);
      grid.push({
        fiscal_year: a.fiscal_year, fiscal_quarter: `Q${n}`,
        idx: idxProbe,
        cy: idxProbe != null ? cyLabel(idxProbe) : "?",
        est_end,
        est: !actual,
        actual,
      });
    }
  }
  return { grid, annuals, actuals };
}

/* 克隆公司并注入合成季(net_income/revenue=1,继承给定 currency/fx),跑 ttmFromPeriods 看是否点亮。
   仅用于「路线可行性」布尔判定,不产出任何财务值。 */
function simulateLights(c, inject) {
  const clone = JSON.parse(JSON.stringify(c));
  clone.periods = (clone.periods || []).slice();
  for (const p of inject) clone.periods.push(p);
  const t = S.ttmFromPeriods(clone, "net_income");
  return { lit: t.complete && t.value != null, asOf: t.asOf, usedImpliedQ4: t.usedImpliedQ4, basis: t.basis };
}

function synthQuarter(c, cell, currency, fx) {
  const start = cell.est_end ? S._addDaysISO(cell.est_end, -80) : null; // 粗略季首(仅供排序/覆盖,不入库)
  return {
    period_id: `__sim-${c.id}-${cell.fiscal_year}-${cell.fiscal_quarter}`,
    kind: "quarter", status: "actual",
    period_start: start, period_end: cell.est_end,
    calendar_year: cell.idx != null ? Math.floor(cell.idx / 4) : null,
    calendar_quarter: cell.idx != null ? "Q" + ((cell.idx % 4) + 1) : null,
    fiscal_year: cell.fiscal_year, fiscal_quarter: cell.fiscal_quarter,
    currency, fx_to_usd: fx, revenue: 1, net_income: 1, segments: [], sources: [],
  };
}

function analyze(c) {
  const u = S.ttmNetIncomeUnified(c);
  const { grid, annuals, actuals } = quarterGrid(c);
  const lines = [];
  lines.push(`▶ ${c.id}  ${c.name}  | 通道: ${CHANNEL[c.id] || "?"}  | 当前 basis: ${u.basis == null ? "null(无 TTM)" : u.basis}`);
  lines.push(`  现有年报: ${annuals.map(a => a.fiscal_year).join(" ") || "—"}`);
  lines.push(`  现有季度: ${actuals.length ? actuals.map(p => `${fq(p)}(${p.period_end},${cyLabel(qidx(p))},ni=${p.net_income == null ? "null" : p.net_income})`).join("  ") : "—(无季度原子)"}`);

  // 币种/FX 一致性(implied Q4 硬约束):latest annual 与其 fiscal Q1-3 是否同 currency+fx
  const latestAnnual = annuals.length ? annuals[annuals.length - 1] : null;

  // ---- 路线 A：最新四个连号日历季全 actual ----
  const anchorIdx = actuals.length ? Math.max(...actuals.map(qidx).filter(i => i != null)) : null;
  if (anchorIdx == null) {
    lines.push(`  路线A(直接·四季全 actual): 无任何 actual 季 → 需从零补最新连续 4 季(参见网格)。`);
  } else {
    const window = [anchorIdx - 3, anchorIdx - 2, anchorIdx - 1, anchorIdx];
    const occupied = new Map();
    for (const p of actuals) { const i = qidx(p); if (i != null) occupied.set(i, p); }
    const missA = [];
    const slots = window.map(i => {
      if (occupied.has(i)) return `有 ${fq(occupied.get(i))}(${cyLabel(i)})`;
      const cell = grid.find(g => g.idx === i);
      const tag = cell ? `${cell.fiscal_quarter} ${cell.fiscal_year} ≈${cell.est_end}` : "?";
      missA.push({ i, cell });
      return `缺 ${cyLabel(i)}[${tag}]`;
    });
    lines.push(`  路线A(直接·四季全 actual) 窗口 ${cyLabel(window[0])}→${cyLabel(anchorIdx)}:`);
    lines.push(`     ${slots.join("  ")}`);
    const injectA = missA.filter(m => m.cell).map(m => synthQuarter(c, m.cell, c.currency || "USD", latestAnnual ? latestAnnual.fx_to_usd : 1));
    const simA = injectA.length ? simulateLights(c, injectA) : { lit: true, asOf: isoOf(anchorIdx) };
    lines.push(`     → 需补 ${missA.length} 季${missA.length ? `(${missA.map(m => m.cell ? `${m.cell.fiscal_quarter} ${m.cell.fiscal_year}` : cyLabel(m.i)).join(", ")})` : "——已满足?"}；补齐后点亮=${simA.lit ? "是" : "否"}`);
  }

  // ---- 路线 B：最新财年 annual + Q1-3,implied Q4 派生 ----
  if (!latestAnnual) {
    lines.push(`  路线B(implied): 无年度 actual → 无法派生 implied Q4。`);
  } else {
    const fyGrid = grid.filter(g => g.fiscal_year === latestAnnual.fiscal_year && g.fiscal_quarter !== "Q4");
    const missB = fyGrid.filter(g => !g.actual);
    const haveB = fyGrid.filter(g => g.actual);
    // FX 一致性:annual 与已有 Q1-3 是否同 currency+fx(混口径 → implied 返 null)
    const fxRefs = haveB.map(g => g.actual).concat(latestAnnual);
    const fxOK = fxRefs.every(p => p.currency === latestAnnual.currency && p.fx_to_usd === latestAnnual.fx_to_usd);
    lines.push(`  路线B(implied) 目标 ${latestAnnual.fiscal_year}: annual − (Q1+Q2+Q3),implied Q4 自动派生`);
    lines.push(`     有 ${haveB.map(g => g.fiscal_quarter).join(",") || "—"} ; 缺 ${missB.map(g => `${g.fiscal_quarter}(≈${g.est_end})`).join(", ") || "—"}`);
    // 模拟:补齐缺的 Q1-3(用 annual 的 currency/fx),看是否点亮
    const injectB = missB.map(g => synthQuarter(c, g, latestAnnual.currency, latestAnnual.fx_to_usd));
    const simB = simulateLights(c, injectB);
    let fxNote = fxOK ? "FX 口径一致 ✓" : `⚠ FX 口径不一致(annual fx=${latestAnnual.fx_to_usd} vs 已有季度 fx 不同)→ implied Q4 会返 null;需按 annual 的 fx_to_usd 口径录 Q1-3,或改走路线A(四季全 actual)`;
    lines.push(`     → 需补 ${missB.length} 季(${missB.map(g => `${g.fiscal_quarter} ${g.fiscal_year}`).join(", ") || "——"})；补齐后点亮=${simB.lit ? "是" : "否"}${simB.lit ? `,TTM as-of≈${simB.asOf}` : ""}；${fxNote}`);
    // 推荐
    const routeBcount = missB.length;
    if (simB.lit && fxOK) lines.push(`  ✅ 建议: 走【路线B】补 ${missB.map(g => `${g.fiscal_quarter} ${g.fiscal_year}`).join(" / ")}（${CHANNEL[c.id]}）`);
    else if (!fxOK) lines.push(`  ✅ 建议: FX 口径受限 → 走【路线A】(四季全 actual,各季自带 fx),或统一用 annual fx 口径重录 Q1-3`);
    else lines.push(`  ✅ 建议: 见上;路线B 模拟未点亮(可能最新 actual 季与该财年窗口不连号),优先补该财年 Q1-3 后复跑本报告`);
  }
  return lines.join("\n");
}

function main() {
  const targets = db.companies.filter(c => S.ttmNetIncomeUnified(c).basis !== "periods");
  const legacy = targets.filter(c => S.ttmNetIncomeUnified(c).basis === "legacy_fallback");
  const none = targets.filter(c => S.ttmNetIncomeUnified(c).basis == null);
  const done = db.companies.filter(c => S.ttmNetIncomeUnified(c).basis === "periods");

  console.log("=".repeat(78));
  console.log(" FALLBACK RETIREMENT — 季度原子购物清单 (tools/gap-report.cjs)");
  console.log(` 生成: ${new Date().toISOString().slice(0, 10)}  |  目标: ttmNetIncomeUnified.basis → periods`);
  console.log("=".repeat(78));
  console.log(`\n已点亮 periods 口径 (${done.length} 家,无需动): ${done.map(c => c.id).join(", ")}`);
  console.log(`待点亮 legacy_fallback (${legacy.length} 家)  +  none/无 TTM (${none.length} 家)\n`);

  console.log("─".repeat(78));
  console.log(`【legacy_fallback ${legacy.length} 家】当前 TTM 走 legacy,补下列季度即切换 periods 口径`);
  console.log("─".repeat(78));
  for (const c of legacy) { console.log(analyze(c)); console.log(""); }

  console.log("─".repeat(78));
  console.log(`【none 组 ${none.length} 家】当前无 TTM(仅年报,无季度原子)`);
  console.log("─".repeat(78));
  for (const c of none) { console.log(analyze(c)); console.log(""); }

  console.log("=".repeat(78));
  console.log(" 说明: ≈ 为按年报跨度估算的目标 period_end,以 filing 明示日期为准;");
  console.log(" fiscal 标签(如 FQ2'26)见现有 periods 命名惯例;采集口径见 docs/DATA-SPEC-dayu.md §2.A。");
  console.log("=".repeat(78));
}

main();
