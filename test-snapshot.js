// test-snapshot.js — 真实数据（companies.json）派生值的快照对账。
// 不硬编码期望值：把关键派生值算出来，与已提交的 test-snapshot.expected.json 逐字段比对。
//   数据变更流程 = 人工确认变更合理 → `node test-snapshot.js --update` 重生成快照 →
//   git diff 里快照变化一目了然、可 review。**数据刷新不再手改测试文件。**
// 另含少量与数据无关的结构不变量（份额和为 1、迁移末位==AI 池、EV 方向自洽等），
// 这些永真断言不进快照，刷新数据也不会误伤。
// CJS：node 与 bun 都可直接跑，也可被 test-data-module.js 薄壳 require（比对模式）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const data = require("./companies.json");
const { Store, Selectors, STAGE_ORDER, STAGE_LABEL, STAGE_COLOR, stageOf, _refreshStages } = require("./data-module.js");

Store._data = data;
_refreshStages(data.meta); // derive STAGE_ORDER/LABEL/COLOR from meta.stages (Store.load does this in browser)

const EXPECTED_PATH = path.join(__dirname, "test-snapshot.expected.json");
const P = 6; // 数值保留小数位（够精、跨 node/bun 稳定、diff 可读）

// 递归把所有数字四舍五入到 P 位（稳定快照、避免浮点尾噪）
function norm(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 10 ** P) / 10 ** P : v;
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const o = {};
    // 剔除值为 undefined 的键，与 JSON 序列化语义对齐（否则重建对象与已存快照产生幻影 diff）
    for (const k of Object.keys(v)) { if (v[k] !== undefined) o[k] = norm(v[k]); }
    return o;
  }
  return v;
}
const safe = (fn) => { try { const r = fn(); return r === undefined ? null : r; } catch { return null; }; };
const segName = (s) => (s && s.name) || null;

// ---- 每家 populated 公司的关键派生值 ----
function companySnapshot(c) {
  const la = safe(() => Selectors.latestActual(c));
  const laFy = la ? la.fy : null;
  const fc = safe(() => Selectors.forecastYear(c));
  const cav = (k) => safe(() => Selectors.valuationCaveat(c, k));
  const rec = safe(() => (la ? Selectors.reconcile(la) : null)) || {};
  const flow = safe(() => Selectors.incomeFlow(la)) || {};
  const ai = safe(() => Selectors.aiShare(c)) || {};
  return {
    latestActualFy: laFy,
    forecastFy: fc ? fc.fy : null,
    segmentKind: safe(() => (la ? Selectors.segmentKind(la) : null)),
    reconcileOk: rec.ok ?? null,
    reconcilePartition: rec.partition ?? null,
    hasSegmentProfit: safe(() => (la ? Selectors.hasSegmentProfit(la) : null)),
    topProfitSegment: safe(() => segName(Selectors.profitSorted(la)[0])),
    topRevSegment: safe(() => segName(Selectors.revenueSorted(la)[0])),
    netMargin: safe(() => Selectors.netMargin(la)),
    opMargin: safe(() => Selectors.opMargin(la)),
    revYoY: safe(() => (laFy ? Selectors.revYoY(c, laFy) : null)),
    niYoY: safe(() => Selectors.niYoY(c)),
    homeRevenue: safe(() => Selectors.homeMetric(c, "revenue")),
    homeNetIncome: safe(() => Selectors.homeMetric(c, "netIncome")),
    marketCap: safe(() => Selectors.marketCap(c)),
    netDebt: safe(() => Selectors.netDebt(c)),
    ev: safe(() => Selectors.ev(c)),
    evSales: safe(() => Selectors.evSales(c)),
    pe: safe(() => Selectors.pe(c)),
    ps: safe(() => Selectors.ps(c)),
    fcfYield: safe(() => Selectors.fcfYield(c)),
    forwardPE: safe(() => Selectors.forwardPE(c)),
    valuationCaveat: { pe: cav("pe"), ps: cav("ps"), fcf_yield: cav("fcf_yield"), ev_sales: cav("ev_sales") },
    ttmNetIncome: safe(() => Selectors.ttmNetIncome(c)),
    ttmAsOf: safe(() => Selectors.ttmAsOf(c)),
    incomeFlowHas: flow.has || null,
    aiShare: { value: ai.value ?? null, basis: ai.basis ?? null },
  };
}

// stage-cross-section 折叠为 {stage:{value,share,companies}}（companies 保留可溯字段）
function stagesMap(stages) {
  const o = {};
  for (const s of stages) o[s.stage] = { value: s.value, share: s.share, companies: s.companies };
  return o;
}

function build() {
  const populated = Store.populated();
  const ids = populated.map((c) => c.id);
  const perCompany = {};
  for (const c of populated) perCompany[c.id] = companySnapshot(c);

  const aiPool = Selectors.profitPoolAI(populated);
  const migration = Selectors.profitPoolMigration(populated);
  const leader = Selectors.profitPoolLeader(populated);
  const yoy = Selectors.profitPoolYoY(populated);
  const ttmPool = Selectors.profitPoolTTM(populated);

  // 同环节相对估值：每家 × 每个可比指标（覆盖 cohortN/median/relative/lowerCheaper/insufficient）
  const relMetrics = ["pe", "ps", "fcfYield", "evSales"];
  const stageValuationRel = {};
  for (const c of populated) {
    const row = {};
    for (const m of relMetrics) {
      const r = safe(() => Selectors.stageValuationRel(c, m)) || {};
      row[m] = {
        value: r.value ?? null, median: r.median ?? null, relative: r.relative ?? null,
        cohortN: r.cohortN ?? null, lowerCheaper: r.lowerCheaper ?? null, insufficient: r.insufficient ?? null,
      };
    }
    stageValuationRel[c.id] = row;
  }

  return norm({
    companyCount: Store.companies().length,
    populatedIds: ids,
    pendingIds: Store.pending().map((c) => c.id),
    stages: { order: STAGE_ORDER, label: STAGE_LABEL, color: STAGE_COLOR },
    perCompany,
    aiPool: { total: aiPool.total, n: aiPool.n, N: aiPool.N, basisCount: aiPool.basisCount, byStage: stagesMap(aiPool.byStage) },
    migration: migration.map((m) => ({ label: m.label, total: m.total, n: m.n, N: m.N, stages: stagesMap(m.stages) })),
    leader: { id: leader.leader ? leader.leader.id : null, share: leader.share, pool: leader.pool, n: leader.n, N: leader.N, basisCount: leader.basisCount },
    yoy: { value: yoy.value, migLastLabel: yoy.migLast ? yoy.migLast.label : null, migPrevLabel: yoy.migPrev ? yoy.migPrev.label : null },
    ttmPool: { total: ttmPool.total, n: ttmPool.n, asOfSpreadDays: ttmPool.asOfSpreadDays, basisCount: ttmPool.basisCount, stages: stagesMap(ttmPool.stages) },
    stageValuationRel,
  });
}

// ---- 结构不变量（数据无关的永真式；刷新数据也不该破坏，不进快照）----
function invariants(snap) {
  const populated = Store.populated();
  const aiPool = Selectors.profitPoolAI(populated);
  const mig = Selectors.profitPoolMigration(populated);
  const leader = Selectors.profitPoolLeader(populated);
  const ttmPool = Selectors.profitPoolTTM(populated);
  if (mig.length) {
    const newest = mig[mig.length - 1];
    // 份额和为 1
    const sumShare = newest.stages.reduce((s, x) => s + x.share, 0);
    assert.ok(Math.abs(sumShare - 1) < 1e-9, "migration newest shares sum to 1: " + sumShare);
    // 迁移末位 total == AI 池 total（同 C 口径）
    assert.ok(Math.abs(newest.total - aiPool.total) < 1e-6, "migration newest total == AI pool total");
    // leader.pool == AI 池 total
    assert.ok(Math.abs(leader.pool - aiPool.total) < 1e-6, "leader pool == AI pool total");
    if (leader.share != null) assert.ok(leader.share > 0 && leader.share <= 1, "leader share in (0,1]: " + leader.share);
  }
  // TTM 份额和为 1（正 total 时）
  if (ttmPool.total > 0) {
    const s = ttmPool.stages.reduce((a, x) => a + x.share, 0);
    assert.ok(Math.abs(s - 1) < 1e-9, "ttm shares sum to 1: " + s);
  }
  // EV 方向：净现金 → EV<市值；净负债 → EV>市值（对每家有 netDebt 的公司）
  for (const c of populated) {
    const nd = Selectors.netDebt(c), mc = Selectors.marketCap(c), ev = Selectors.ev(c);
    if (nd != null && mc != null && ev != null) {
      if (nd < 0) assert.ok(ev < mc, c.id + " 净现金 → EV<市值");
      if (nd > 0) assert.ok(ev > mc, c.id + " 净负债 → EV>市值");
      assert.ok(Math.abs(ev - (mc + nd)) < 1e-6, c.id + " EV == 市值+净负债");
    }
  }
  // aiShare basis 合法
  for (const c of populated) {
    const b = (Selectors.aiShare(c) || {}).basis;
    assert.ok(["sourced", "proxy", "none"].includes(b), c.id + " aiShare basis 合法: " + b);
  }
  // ---- hotfix 2026-07-07 回归 (真实数据锚点): calendarYear 按 implied fiscal-Q4 落入的 calendar
  //      slot 补齐, 故财年错位公司的 CY 也能诚实补齐。MSFT (6月末财年) 的 implied 落 calendar Q2 →
  //      complete=true 且 strict=true (季恰对齐 3/6/9/12 月末); Oracle (月度错位 2/5/8/11 月末) →
  //      complete=true 但 strict=false ("自然年近似")。数据刷新致形状变时这里会响, 属预期护栏。 ----
  const byId = (id) => Store.companies().find((c) => c.id === id);
  const msft = byId("microsoft");
  if (msft) {
    const cy = Selectors.calendarYear(msft, 2025);
    assert.equal(cy.complete, true, "microsoft CY2025 应 complete (implied 落 calendar Q2 补齐)");
    assert.equal(cy.strict, true, "microsoft CY2025 应 strict (季对齐日历季)");
    assert.ok(!cy.missing.includes("Q2"), "microsoft CY2025 不再误报缺 Q2");
  }
  const ora = byId("oracle");
  if (ora) {
    const cy = Selectors.calendarYear(ora, 2025);
    assert.equal(cy.complete, true, "oracle CY2025 应 complete");
    assert.equal(cy.strict, false, "oracle CY2025 应 strict=false (月度错位, 自然年近似)");
  }

  // Amazon FY2024 International 营业利润以 10-K 官方精确值为准；years/periods 双写必须同值。
  const amazon = byId("amazon");
  if (amazon) {
    const annualYear = amazon.years.find((y) => y.fy === "FY2024");
    const annualPeriod = amazon.periods.find((p) => p.period_id === "amazon-fy2024-annual");
    const intlYear = annualYear?.segments.find((s) => s.name === "International 国际");
    const intlPeriod = annualPeriod?.segments.find((s) => s.name === "International 国际");
    assert.equal(intlYear?.op_income, 3.792, "amazon FY2024 International years op_income 应为官方 $3.792B");
    assert.equal(intlPeriod?.op_income, 3.792, "amazon FY2024 International period op_income 应为官方 $3.792B");

    const expectedQuarterIds = [
      "amazon-2023q3", "amazon-2024q1", "amazon-2024q2", "amazon-2024q3",
      "amazon-2025q1", "amazon-2025q2", "amazon-2025q3", "amazon-2026q1",
    ];
    const quarters = amazon.periods.filter((p) => p.kind === "quarter" && p.status === "actual");
    assert.deepEqual(quarters.map((p) => p.period_id), expectedQuarterIds, "amazon 实际季度集合应完整且顺序稳定");
    for (const q of quarters) {
      const rb = q.revenue_breakdown;
      assert.equal(rb?.complete, true, `${q.period_id} 应带 complete=true 的官方收入拆分`);
      assert.equal(rb?.items.length, 7, `${q.period_id} 应有七类官方收入拆分`);
      assert.ok(rb.sources.length > 0 && rb.sources.every((s) => s.data_status === "official"), `${q.period_id} 收入拆分来源应全为 official`);
      const sum = rb.items.reduce((acc, item) => acc + item.revenue, 0);
      assert.ok(Math.abs(sum - q.revenue) <= 0.001, `${q.period_id} 七类收入应精确对账：${sum} vs ${q.revenue}`);
    }

    const expectedQuarterSegments = {
      "amazon-2023q3": [11.188, [["North America 北美", 87.887, 4.307], ["International 国际", 32.137, -0.095], ["AWS 亚马逊云", 23.059, 6.976]]],
      "amazon-2024q1": [15.307, [["North America 北美", 86.341, 4.983], ["International 国际", 31.935, 0.903], ["AWS 亚马逊云", 25.037, 9.421]]],
      "amazon-2024q2": [14.672, [["North America 北美", 90.033, 5.065], ["International 国际", 31.663, 0.273], ["AWS 亚马逊云", 26.281, 9.334]]],
      "amazon-2024q3": [17.411, [["North America 北美", 95.537, 5.663], ["International 国际", 35.888, 1.301], ["AWS 亚马逊云", 27.452, 10.447]]],
      "amazon-2025q1": [18.405, [["North America 北美", 92.887, 5.841], ["International 国际", 33.513, 1.017], ["AWS 亚马逊云", 29.267, 11.547]]],
      "amazon-2025q2": [19.171, [["North America 北美", 100.068, 7.517], ["International 国际", 36.761, 1.494], ["AWS 亚马逊云", 30.873, 10.16]]],
      "amazon-2025q3": [17.422, [["North America 北美", 106.267, 4.789], ["International 国际", 40.896, 1.199], ["AWS 亚马逊云", 33.006, 11.434]]],
      "amazon-2026q1": [23.852, [["North America 北美", 104.143, 8.267], ["International 国际", 39.789, 1.424], ["AWS 亚马逊云", 37.587, 14.161]]],
    };
    for (const q of quarters) {
      const [expectedOpIncome, expectedSegments] = expectedQuarterSegments[q.period_id];
      assert.equal(q.op_income, expectedOpIncome, `${q.period_id} 合并营业利润应取官方精确值`);
      assert.deepEqual(
        q.segments.map((s) => [s.name, s.revenue, s.op_income]),
        expectedSegments,
        `${q.period_id} 三个报告分部应与官方表一致`,
      );
      assert.ok(q.segments.every((s) => s.kind === "platform"), `${q.period_id} 三个报告分部 kind 应一致`);
      const segmentRevenue = q.segments.reduce((acc, segment) => acc + segment.revenue, 0);
      const segmentOpIncome = q.segments.reduce((acc, segment) => acc + segment.op_income, 0);
      assert.ok(Math.abs(segmentRevenue - q.revenue) <= 0.001, `${q.period_id} 分部收入应精确对账`);
      assert.ok(Math.abs(segmentOpIncome - q.op_income) <= 0.001, `${q.period_id} 分部营业利润应精确对账`);
    }
  }
}

// ---- 递归 diff：列出所有不一致路径（expected vs actual）----
function diff(exp, act, base, out) {
  if (JSON.stringify(exp) === JSON.stringify(act)) return;
  const isObj = (x) => x && typeof x === "object";
  if (!isObj(exp) || !isObj(act) || Array.isArray(exp) !== Array.isArray(act)) {
    out.push(`  ${base}\n      期望: ${JSON.stringify(exp)}\n      实际: ${JSON.stringify(act)}`);
    return;
  }
  const keys = new Set([...Object.keys(exp), ...Object.keys(act)]);
  for (const k of keys) {
    const p = base ? `${base}.${k}` : String(k);
    if (!(k in exp)) { out.push(`  ${p}\n      期望: <缺失>\n      实际: ${JSON.stringify(act[k])}`); continue; }
    if (!(k in act)) { out.push(`  ${p}\n      期望: ${JSON.stringify(exp[k])}\n      实际: <缺失>`); continue; }
    diff(exp[k], act[k], p, out);
  }
}

function main() {
  const update = process.argv.includes("--update");
  const snap = build();
  invariants(snap);

  if (update) {
    fs.writeFileSync(EXPECTED_PATH, JSON.stringify(snap, null, 2) + "\n", "utf8");
    console.log("snapshot updated → test-snapshot.expected.json（请 git diff 复核数据变化是否符合预期）");
    return;
  }

  if (!fs.existsSync(EXPECTED_PATH)) {
    console.error("缺少 test-snapshot.expected.json —— 先跑 `node test-snapshot.js --update` 生成基线");
    process.exit(1);
  }
  const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, "utf8"));
  const out = [];
  diff(expected, snap, "", out);
  if (out.length) {
    console.error("快照对账失败：以下派生值与 test-snapshot.expected.json 不一致\n");
    console.error(out.join("\n"));
    console.error(`\n共 ${out.length} 处不一致。若数据变更合理，跑 \`node test-snapshot.js --update\` 更新快照并复核 git diff。`);
    process.exit(1);
  }
  console.log("snapshot tests passed");
}

main();
