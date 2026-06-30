const assert = require("node:assert/strict");
const data = require("./companies.json");
const { Store, Selectors, STAGE_OF, STAGE_ORDER, STAGE_LABEL } = require("./data-module.js");

Store._data = data;

assert.equal(Store.companies().length, 8);
assert.deepEqual(Store.populated().map((c) => c.id), ["nvda", "samsung", "broadcom", "softbank", "micron", "skhynix", "tsmc", "asml"]);
assert.deepEqual(Store.pending().map((c) => c.id), []);

const nvda = Store.byId("nvda");
const nvda2026 = Selectors.yearByFy(nvda, "FY2026");
assert.equal(Selectors.latestActual(nvda).fy, "FY2026");
assert.equal(Selectors.forecastYear(nvda).fy, "FY2027E");
assert.equal(Selectors.segmentKind(nvda2026), "platform");
assert.equal(Selectors.reconcile(nvda2026).ok, true);
assert.equal(Selectors.hasSegmentProfit(nvda2026), false);
assert.equal(Math.round(Selectors.netMargin(nvda2026) * 1000) / 1000, 0.556);
assert.equal(Math.round(Selectors.revYoY(nvda, "FY2026") * 1000) / 1000, 0.655);

const samsung = Store.byId("samsung");
const samsung2025 = Selectors.yearByFy(samsung, "FY2025");
const samsungRec = Selectors.reconcile(samsung2025);
assert.equal(Selectors.segmentKind(samsung2025), "division");
assert.equal(samsungRec.partition, false);
assert.equal(samsungRec.ok, false);
assert.equal(Selectors.hasSegmentProfit(samsung2025), true);
assert.equal(Selectors.profitSorted(samsung2025)[0].name, "DS 半导体（存储/代工/LSI）");

const broadcom = Store.byId("broadcom");
const broadcom2025 = Selectors.yearByFy(broadcom, "FY2025");
assert.equal(Selectors.latestActual(broadcom).fy, "FY2025");
assert.equal(Selectors.reconcile(broadcom2025).ok, true);
assert.equal(Selectors.hasSegmentProfit(broadcom2025), true);
assert.equal(Selectors.profitSorted(broadcom2025)[0].name, "Semiconductor solutions 半导体解决方案");

const softbank = Store.byId("softbank");
const softbank2025 = Selectors.yearByFy(softbank, "FY2025");
assert.equal(Selectors.latestActual(softbank).fy, "FY2025");
assert.equal(Selectors.reconcile(softbank2025).ok, true);
assert.equal(Selectors.hasSegmentProfit(softbank2025), false);

const micron = Store.byId("micron");
const micron2025 = Selectors.yearByFy(micron, "FY2025");
assert.equal(Selectors.latestActual(micron).fy, "FY2025");
assert.equal(Selectors.reconcile(micron2025).ok, true);
assert.equal(Selectors.hasSegmentProfit(micron2025), true);
assert.equal(Selectors.profitSorted(micron2025)[0].name, "CMBU 云存储");

const skhynix = Store.byId("skhynix");
const skhynix2025 = Selectors.yearByFy(skhynix, "FY2025");
assert.equal(Selectors.latestActual(skhynix).fy, "FY2025");
assert.equal(Selectors.reconcile(skhynix2025).ok, true);
assert.equal(Selectors.hasSegmentProfit(skhynix2025), false);
// FY2025 现金已补录（capex 19.36 / cfo 37.3，KRW→USD 换算）：FCF 派生、FCF yield 出值
assert.equal(Math.round(Selectors.fcf(skhynix2025) * 100) / 100, 17.94); // 37.3 − 19.36
assert.equal(Math.round(Selectors.fcfYield(skhynix) * 10000) / 10000, 0.0145); // fcf 17.94 / mcap 1236

const tsmc = Store.byId("tsmc");
const tsmc2025 = Selectors.yearByFy(tsmc, "FY2025");
assert.equal(Selectors.latestActual(tsmc).fy, "FY2025");
assert.equal(Selectors.reconcile(tsmc2025).ok, true);
assert.equal(Selectors.hasSegmentProfit(tsmc2025), false);

const asml = Store.byId("asml");
const asml2025 = Selectors.yearByFy(asml, "FY2025");
assert.equal(Selectors.latestActual(asml).fy, "FY2025");
assert.equal(Selectors.reconcile(asml2025).ok, true);
assert.equal(Selectors.hasSegmentProfit(asml2025), false);

assert.equal(Selectors.homeMetric(nvda, "revenue"), 215.94);
assert.equal(Selectors.homeMetric(nvda, "netIncome"), 120.10);
assert.equal(Selectors.homeMetric(nvda, "unknown"), null);
assert.equal(Store.byId("missing-company"), undefined);

const forecastOnly = {
  id: "forecast-only",
  status: "populated",
  years: [
    { fy: "FY2027E", status: "forecast", revenue: 10, net_income: 2, segments: [] },
  ],
};
assert.equal(Selectors.latestActual(forecastOnly), null);
assert.equal(Selectors.forecastYear(forecastOnly).fy, "FY2027E");
assert.equal(Selectors.homeMetric(forecastOnly, "revenue"), null);

const zeroRevenue = { fy: "FY0", status: "actual", revenue: 0, op_income: 0, net_income: 0, segments: [] };
assert.equal(Selectors.netMargin(zeroRevenue), null);
assert.equal(Selectors.opMargin(zeroRevenue), null);

const changedSegments = {
  years: [
    { fy: "FY1", status: "actual", revenue: 10, net_income: 1, segments: [{ name: "A", kind: "platform", revenue: 10 }] },
    { fy: "FY2", status: "actual", revenue: 20, net_income: 2, segments: [{ name: "B", kind: "platform", revenue: 20 }] },
  ],
};
assert.equal(Selectors.segYoY(changedSegments, "FY2", "B"), null);

// cash & capital intensity (FCF derived, never stored)
const cashYear = { fy: "FY1", status: "actual", revenue: 100, net_income: 20, capex: 30, cfo: 50 };
assert.equal(Selectors.capexIntensity(cashYear), 0.3);
assert.equal(Selectors.fcf(cashYear), 20);          // 50 − 30
assert.equal(Selectors.fcfMargin(cashYear), 0.2);   // 20 / 100
assert.equal(Selectors.cashConversion(cashYear), 1);// 20 / 20
const downturn = { fy: "FY0", status: "actual", revenue: 16, net_income: -6, capex: 7, cfo: 1.5 };
assert.equal(Math.round(Selectors.fcf(downturn) * 10) / 10, -5.5);   // negative FCF in a downcycle
assert.equal(Math.round(Selectors.fcfMargin(downturn) * 1000) / 1000, -0.344); // -5.5 / 16
const noCash = { fy: "FY2", status: "actual", revenue: 100, net_income: 20 };
assert.equal(Selectors.fcf(noCash), null);
assert.equal(Selectors.capexIntensity(noCash), null);
assert.equal(Selectors.fcfMargin(noCash), null);
assert.equal(Selectors.cashConversion(noCash), null);
const halfCash = { fy: "FY3", status: "actual", revenue: 100, net_income: 20, capex: 30 }; // cfo missing
assert.equal(Selectors.fcf(halfCash), null);        // both inputs required
assert.equal(Selectors.capexIntensity(halfCash), 0.3); // capex intensity needs only capex
assert.equal(Selectors.homeMetric({ years: [cashYear] }, "fcfMargin"), 0.2);
assert.equal(Selectors.homeMetric({ years: [cashYear] }, "capexInt"), 0.3);

// ---- valuation: PE / PS / FCF yield (derived from quote vs latest actual; never stored) ----
const vCompany = {
  id: "v-co", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, sources: [] },
  years: [
    { fy: "FY1", status: "actual", revenue: 100, net_income: 20, capex: 30, cfo: 50 }, // fcf = 20
  ],
};
assert.equal(Selectors.marketCap(vCompany), 200);
assert.equal(Selectors.pe(vCompany), 10);          // 200 / 20
assert.equal(Selectors.ps(vCompany), 2);           // 200 / 100
assert.equal(Selectors.fcfYield(vCompany), 0.1);   // fcf 20 / mcap 200
assert.equal(Selectors.valuationCaveat(vCompany, "pe"), "ok");  // 缺省 → ok
assert.equal(Selectors.homeMetric(vCompany, "pe"), 10);
assert.equal(Selectors.homeMetric(vCompany, "ps"), 2);
assert.equal(Selectors.homeMetric(vCompany, "fcfYield"), 0.1);

// null 降级：缺 quote → 所有倍数 null
const noQuote = { id: "nq", status: "populated", years: [{ fy: "FY1", status: "actual", revenue: 100, net_income: 20, capex: 30, cfo: 50 }] };
assert.equal(Selectors.marketCap(noQuote), null);
assert.equal(Selectors.pe(noQuote), null);
assert.equal(Selectors.ps(noQuote), null);
assert.equal(Selectors.fcfYield(noQuote), null);
assert.equal(Selectors.homeMetric(noQuote, "pe"), null);

// null 降级：有 quote 但缺分母 → 该倍数 null（FCF yield 缺 cfo/capex）
const noDenom = { id: "nd", status: "populated", quote: { as_of: "2026-06-26", market_cap: 200, sources: [] },
  years: [{ fy: "FY1", status: "actual", revenue: 0, net_income: 0 }] };
assert.equal(Selectors.pe(noDenom), null);         // net_income 0 → 零分母
assert.equal(Selectors.ps(noDenom), null);         // revenue 0 → 零分母
assert.equal(Selectors.fcfYield(noDenom), null);   // 缺 cfo/capex → fcf null

// null 降级：无实际年（仅预测）→ null
const fcOnly = { id: "fc", status: "populated", quote: { as_of: "2026-06-26", market_cap: 200, sources: [] },
  years: [{ fy: "FY2027E", status: "forecast", revenue: 100, net_income: 20 }] };
assert.equal(Selectors.pe(fcOnly), null);
assert.equal(Selectors.ps(fcOnly), null);
assert.equal(Selectors.fcfYield(fcOnly), null);

// caveat="na" → 整项留空(null)，即便分母齐备
const naCaveat = { id: "na", status: "populated", quote: { as_of: "2026-06-26", market_cap: 200, sources: [] },
  valuation_caveat: { pe: "na", fcf_yield: "na", ps: "ok" },
  years: [{ fy: "FY1", status: "actual", revenue: 100, net_income: 20, capex: 30, cfo: 50 }] };
assert.equal(Selectors.pe(naCaveat), null);        // na → null
assert.equal(Selectors.fcfYield(naCaveat), null);  // na → null
assert.equal(Selectors.ps(naCaveat), 2);           // ps ok → 正常返回
assert.equal(Selectors.valuationCaveat(naCaveat, "pe"), "na");
assert.equal(Selectors.valuationCaveat(naCaveat, "fcf_yield"), "na");
assert.equal(Selectors.homeMetric(naCaveat, "pe"), null);
assert.equal(Selectors.homeMetric(naCaveat, "fcfYield"), null);

// caveat="distorted" → 仍返回数值（供视图警示），并能查到三态
const distorted = { id: "ds", status: "populated", quote: { as_of: "2026-06-26", market_cap: 300, sources: [] },
  valuation_caveat: { ps: "distorted" },
  years: [{ fy: "FY1", status: "actual", revenue: 50, net_income: 30 }] };
assert.equal(Selectors.ps(distorted), 6);          // distorted 仍算 300/50
assert.equal(Selectors.valuationCaveat(distorted, "ps"), "distorted");

// 真实数据：SoftBank caveat 落地（pe/fcf_yield=na 留空，ps=distorted 仍出值）
const sbReal = Store.byId("softbank");
assert.equal(Selectors.valuationCaveat(sbReal, "pe"), "na");
assert.equal(Selectors.valuationCaveat(sbReal, "ps"), "distorted");
assert.equal(Selectors.valuationCaveat(sbReal, "fcf_yield"), "na");
assert.equal(Selectors.pe(sbReal), null);
assert.equal(Selectors.fcfYield(sbReal), null);
assert.ok(Selectors.ps(sbReal) > 0);               // PS 照常出值（失真，视图警示）

// 真实数据：NVDA 有市值、无 caveat → PE/PS 正常；FCF yield 缺 cfo/capex → null
const nvdaReal = Store.byId("nvda");
assert.ok(Selectors.pe(nvdaReal) > 0);
assert.ok(Selectors.ps(nvdaReal) > 0);
// FCF yield 用最近有现金数据的年（FY2026 已录 cfo 102.7/capex 6.1：fcf 96.6 / mcap 4660）
assert.equal(Math.round(Selectors.fcfYield(nvdaReal) * 10000) / 10000, 0.0207);

// FCF yield 现金口径：latestActual 缺现金时回退到 latestCashYear（早一年）
const lagCash = { id: "lag", status: "populated", quote: { as_of: "2026-06-26", market_cap: 100, sources: [] },
  years: [
    { fy: "FY1", status: "actual", revenue: 50, net_income: 10, capex: 4, cfo: 14 },  // fcf = 10
    { fy: "FY2", status: "actual", revenue: 60, net_income: 12 },                      // 最新年无现金输入
  ] };
assert.equal(Selectors.fcf(Selectors.latestActual(lagCash)), null); // 最新年算不出 FCF
assert.equal(Selectors.fcfYield(lagCash), 0.1);                     // 回退 FY1：fcf 10 / mcap 100
assert.equal(Selectors.homeMetric(lagCash, "fcfYield"), 0.1);

// =====================================================================
// EV / EV-Sales / niYoY (PEG 近似的 G) — 派生，算不存，null-safe
// =====================================================================
function syn0(id, years) { return { id, name: id.toUpperCase(), status: "populated", years }; }

// 合成：净负债正 → EV>市值；净现金（负 net_debt）→ EV<市值
const evDebt = { id: "evd", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, net_debt: 50, sources: [] },
  years: [{ fy: "FY1", status: "actual", revenue: 100, net_income: 20 }] };
assert.equal(Selectors.netDebt(evDebt), 50);
assert.equal(Selectors.ev(evDebt), 250);            // 200 + 50（净负债 → EV>市值）
assert.equal(Selectors.evSales(evDebt), 2.5);       // 250 / 100

const evCash = { id: "evc", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, net_debt: -60, sources: [] },
  years: [{ fy: "FY1", status: "actual", revenue: 100, net_income: 20 }] };
assert.equal(Selectors.ev(evCash), 140);            // 200 + (−60)（净现金 → EV<市值）
assert.equal(Selectors.evSales(evCash), 1.4);       // 140 / 100

// 缺 net_debt（区分"缺失"与"0"）→ ev/evSales null（不可假设 EV=市值）
const evNoDebt = { id: "evn", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, sources: [] },
  years: [{ fy: "FY1", status: "actual", revenue: 100, net_income: 20 }] };
assert.equal(Selectors.netDebt(evNoDebt), null);
assert.equal(Selectors.ev(evNoDebt), null);
assert.equal(Selectors.evSales(evNoDebt), null);

// net_debt 显式为 0（零净负债，已知）→ EV=市值（与"缺失"不同）
const evZero = { id: "evz", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, net_debt: 0, sources: [] },
  years: [{ fy: "FY1", status: "actual", revenue: 100, net_income: 20 }] };
assert.equal(Selectors.ev(evZero), 200);            // 已知零净负债 → EV=市值
assert.equal(Selectors.evSales(evZero), 2);

// 缺 market_cap → ev null（即便有 net_debt）
const evNoMc = { id: "evm", status: "populated",
  quote: { as_of: "2026-06-26", net_debt: 50, sources: [] },
  years: [{ fy: "FY1", status: "actual", revenue: 100, net_income: 20 }] };
assert.equal(Selectors.ev(evNoMc), null);
assert.equal(Selectors.evSales(evNoMc), null);

// 零分母 revenue → evSales null
const evNoRev = { id: "evr", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, net_debt: 50, sources: [] },
  years: [{ fy: "FY1", status: "actual", revenue: 0, net_income: 0 }] };
assert.equal(Selectors.ev(evNoRev), 250);
assert.equal(Selectors.evSales(evNoRev), null);     // revenue 0 → 零分母

// 仅预测年（无实际年）→ evSales null
const evFcOnly = { id: "evf", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, net_debt: 50, sources: [] },
  years: [{ fy: "FY2027E", status: "forecast", revenue: 100, net_income: 20 }] };
assert.equal(Selectors.evSales(evFcOnly), null);

// caveat ev_sales="na" → evSales null（即便分母齐备），但 ev 原子值仍可算
const evNa = { id: "evna", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, net_debt: 50, sources: [] },
  valuation_caveat: { ev_sales: "na" },
  years: [{ fy: "FY1", status: "actual", revenue: 100, net_income: 20 }] };
assert.equal(Selectors.evSales(evNa), null);
assert.equal(Selectors.ev(evNa), 250);
assert.equal(Selectors.valuationCaveat(evNa, "ev_sales"), "na");

// caveat ev_sales="distorted" → 仍出值（供视图警示）
const evDist = { id: "evdi", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, net_debt: 100, sources: [] },
  valuation_caveat: { ev_sales: "distorted" },
  years: [{ fy: "FY1", status: "actual", revenue: 50, net_income: 10 }] };
assert.equal(Selectors.evSales(evDist), 6);         // (200+100)/50，distorted 仍算
assert.equal(Selectors.valuationCaveat(evDist, "ev_sales"), "distorted");

// homeMetric evSales 登记表 key
assert.equal(Selectors.homeMetric(evDebt, "evSales"), 2.5);
assert.equal(Selectors.homeMetric(evNoDebt, "evSales"), null);
assert.equal(Selectors.homeMetric(evNa, "evSales"), null);

// ---- niYoY（PEG 近似的 G）：仅上一年 net_income>0 才算 ----
const niPos = syn0("ni1", [
  { fy: "FY1", status: "actual", revenue: 100, net_income: 20 },
  { fy: "FY2", status: "actual", revenue: 120, net_income: 30 },
]);
assert.equal(Selectors.niYoY(niPos), 0.5);          // (30−20)/20

// 上一年净利 ≤0（周期反转）→ null（基期无意义，不可比）
const niTurn = syn0("ni2", [
  { fy: "FY1", status: "actual", revenue: 100, net_income: -5 },
  { fy: "FY2", status: "actual", revenue: 120, net_income: 30 },
]);
assert.equal(Selectors.niYoY(niTurn), null);
const niZeroBase = syn0("ni2b", [
  { fy: "FY1", status: "actual", revenue: 100, net_income: 0 },
  { fy: "FY2", status: "actual", revenue: 120, net_income: 30 },
]);
assert.equal(Selectors.niYoY(niZeroBase), null);    // 基期 0 → 不可比

// <2 个实际年 → null
const niOne = syn0("ni3", [{ fy: "FY1", status: "actual", revenue: 100, net_income: 20 }]);
assert.equal(Selectors.niYoY(niOne), null);

// 缺 net_income（当前或基期）→ null
const niMissing = syn0("ni4", [
  { fy: "FY1", status: "actual", revenue: 100, net_income: 20 },
  { fy: "FY2", status: "actual", revenue: 120, net_income: null },
]);
assert.equal(Selectors.niYoY(niMissing), null);

// 预测年不参与基期判定：以实际年为准
const niWithForecast = syn0("ni5", [
  { fy: "FY1", status: "actual", revenue: 100, net_income: 20 },
  { fy: "FY2", status: "actual", revenue: 120, net_income: 24 },
  { fy: "FY3E", status: "forecast", revenue: 200, net_income: 50 },
]);
assert.equal(Math.round(Selectors.niYoY(niWithForecast) * 1000) / 1000, 0.2); // (24−20)/20

// ---- 真实数据：ev 方向自检 ----
// NVDA 净现金（net_debt −54.09）→ EV < 市值
assert.equal(Math.round(Selectors.ev(nvdaReal) * 100) / 100, 4605.91); // 4660 − 54.09
assert.ok(Selectors.ev(nvdaReal) < Selectors.marketCap(nvdaReal), "NVDA 净现金 → EV<市值");
// evSales 与 ps 差异可解释：净现金 → EV/Sales < PS
assert.ok(Selectors.evSales(nvdaReal) < Selectors.ps(nvdaReal), "NVDA 净现金 → EV/Sales < PS");

// Broadcom 净负债（+49.6）→ EV > 市值，EV/Sales > PS
assert.equal(Math.round(Selectors.ev(broadcom) * 10) / 10, 1785.6); // 1736 + 49.6
assert.ok(Selectors.ev(broadcom) > Selectors.marketCap(broadcom), "AVGO 净负债 → EV>市值");
assert.ok(Selectors.evSales(broadcom) > Selectors.ps(broadcom), "AVGO 净负债 → EV/Sales > PS");

// SoftBank：ev_sales caveat = distorted，evSales 仍出值（高杠杆 → EV>>市值）
assert.equal(Selectors.valuationCaveat(softbank, "ev_sales"), "distorted");
assert.ok(Selectors.evSales(softbank) > 0, "SoftBank EV/Sales distorted 仍出值");
assert.ok(Selectors.ev(softbank) > Selectors.marketCap(softbank), "SoftBank 高杠杆 → EV>市值");

// =====================================================================
// profit-pool migration (value-chain stacked, sample-complete years only)
// =====================================================================

// ---- stage map constants ----
assert.deepEqual(STAGE_ORDER, ["design", "foundry", "memory", "equipment", "invest"]);
assert.equal(STAGE_OF.nvda, "design");
assert.equal(STAGE_OF.broadcom, "design");
assert.equal(STAGE_OF.tsmc, "foundry");
assert.equal(STAGE_OF.samsung, "memory");
assert.equal(STAGE_OF.skhynix, "memory");
assert.equal(STAGE_OF.micron, "memory");
assert.equal(STAGE_OF.asml, "equipment");
assert.equal(STAGE_OF.softbank, "invest");
assert.equal(STAGE_LABEL.design, "设计");
assert.equal(STAGE_LABEL.invest, "投资");

// ---- synthetic: full coverage of edge cases (8 companies, one per real id) ----
// pos 0 (latest) complete for all; pos 1 missing one company → dropped;
// negative net income present (memory downcycle) to prove no crash.
function syn(id, years) { return { id, name: id.toUpperCase(), status: "populated", years }; }
const A = (fy, pe, ni) => ({ fy, period_end: pe, status: "actual", revenue: 100, net_income: ni });

const synCos = [
  // design = 30 + 10 = 40
  syn("nvda",     [A("FY24", "截至 2024-01", 5), A("FY25", "截至 2025-01", 30)]),
  syn("broadcom", [A("FY24", "截至 2024-11", 4), A("FY25", "截至 2025-11", 10)]),
  // foundry = 20
  syn("tsmc",     [A("FY24", "自然年 2024", 8), A("FY25", "自然年 2025", 20)]),
  // memory = 15 + (-5) + 10 = 20
  syn("samsung",  [/* no pos-1 actual */         A("FY25", "自然年 2025", 15)]),
  syn("skhynix",  [A("FY24", "自然年 2024", 3), A("FY25", "自然年 2025", -5)]), // negative
  syn("micron",   [A("FY24", "截至 2024-08", 2), A("FY25", "截至 2025-08", 10)]),
  // equipment = 10
  syn("asml",     [A("FY24", "自然年 2024", 6), A("FY25", "自然年 2025", 10)]),
  // invest = 10
  syn("softbank", [A("FY24", "截至 2025-03", 1), A("FY25", "截至 2026-03", 10)]),
];
const synMig = Selectors.profitPoolMigration(synCos);

// samsung has no pos-1 actual → pos 1 incomplete → only pos 0 survives
assert.equal(synMig.length, 1);
const sp0 = synMig[0];
assert.equal(sp0.n, 8);
// label = mode of years at pos 0 (all 2025/2026; 2025 dominates) = ≈2025
assert.equal(sp0.label, "≈2025");
// total = 30+10+20+15-5+10+10+10 = 100
assert.equal(sp0.total, 100);
// stages ordered per STAGE_ORDER
assert.deepEqual(sp0.stages.map(s => s.stage), STAGE_ORDER);
const byStage = Object.fromEntries(sp0.stages.map(s => [s.stage, s]));
assert.equal(byStage.design.value, 40);
assert.equal(byStage.foundry.value, 20);
assert.equal(byStage.memory.value, 20);   // 15 + (-5) + 10, negative folded in, no crash
assert.equal(byStage.equipment.value, 10);
assert.equal(byStage.invest.value, 10);
// shares sum to 1 (positive total scenario)
assert.equal(sp0.stages.reduce((s, x) => s + x.share, 0), 1);
// company-level traceability (hover), incl. the negative member
assert.deepEqual(byStage.design.companies.map(c => c.id), ["nvda", "broadcom"]);
assert.deepEqual(byStage.memory.companies.map(c => ({ id: c.id, ni: c.ni })),
  [{ id: "samsung", ni: 15 }, { id: "skhynix", ni: -5 }, { id: "micron", ni: 10 }]);

// ---- synthetic: a company with net_income null at a position → position dropped ----
const synNull = [
  syn("nvda",     [A("FY25", "截至 2025-01", 30)]),
  syn("broadcom", [A("FY25", "截至 2025-11", 10)]),
  syn("tsmc",     [A("FY25", "自然年 2025", 20)]),
  syn("samsung",  [{ fy: "FY25", period_end: "自然年 2025", status: "actual", revenue: 100, net_income: null }]),
  syn("skhynix",  [A("FY25", "自然年 2025", 5)]),
  syn("micron",   [A("FY25", "截至 2025-08", 5)]),
  syn("asml",     [A("FY25", "自然年 2025", 10)]),
  syn("softbank", [A("FY25", "截至 2026-03", 10)]),
];
assert.equal(Selectors.profitPoolMigration(synNull).length, 0); // null NI → not complete
assert.deepEqual(Selectors.profitPoolMigration([]), []);        // empty → empty

// ---- synthetic: chronological ordering (old → new) ----
const synTwo = [
  syn("nvda",     [A("FY24", "截至 2024-01", 1), A("FY25", "截至 2025-01", 2)]),
  syn("broadcom", [A("FY24", "截至 2024-11", 1), A("FY25", "截至 2025-11", 2)]),
  syn("tsmc",     [A("FY24", "自然年 2024", 1), A("FY25", "自然年 2025", 2)]),
  syn("samsung",  [A("FY24", "自然年 2024", 1), A("FY25", "自然年 2025", 2)]),
  syn("skhynix",  [A("FY24", "自然年 2024", 1), A("FY25", "自然年 2025", 2)]),
  syn("micron",   [A("FY24", "截至 2024-08", 1), A("FY25", "截至 2025-08", 2)]),
  syn("asml",     [A("FY24", "自然年 2024", 1), A("FY25", "自然年 2025", 2)]),
  syn("softbank", [A("FY24", "截至 2025-03", 1), A("FY25", "截至 2026-03", 2)]),
];
const twoMig = Selectors.profitPoolMigration(synTwo);
assert.equal(twoMig.length, 2);
assert.equal(twoMig[0].label, "≈2024"); // older first
assert.equal(twoMig[1].label, "≈2025"); // newer last
assert.equal(twoMig[0].total, 8);
assert.equal(twoMig[1].total, 16);

// ---- real data: two complete positions, newest = ≈2025 ----
const realMig = Selectors.profitPoolMigration(Store.populated());
assert.equal(realMig.length, 2);                 // pos 0 & 1 complete; pos 2 drops (samsung 2-yr only)
const newest = realMig[realMig.length - 1];
assert.equal(newest.n, 8);
assert.equal(newest.label, "≈2025");

// newest total == home-page "profit pool" 口径: sum of each company's latest-actual net_income
const homePool = Store.populated().reduce((s, c) => s + Selectors.latestActual(c).net_income, 0);
assert.ok(Math.abs(newest.total - homePool) < 1e-9);

// shares sum to 1
assert.ok(Math.abs(newest.stages.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);

// stage shares reflect the canonical data (current companies.json: NVDA FY2026 NI 120.1).
// NOTE: these are the TRUE shares under the data; they differ materially from the
// brief's pre-data estimate (design~37/memory~27/foundry~21/invest~12/equip~4).
// See report — flagged as a data/expectation mismatch, asserting reality not the estimate.
const nb = Object.fromEntries(newest.stages.map(s => [s.stage, s.share]));
const near = (a, b) => Math.abs(a - b) <= 0.005; // ±0.5pp
assert.ok(near(nb.design, 0.463), "design share " + nb.design);
assert.ok(near(nb.foundry, 0.175), "foundry share " + nb.foundry);
assert.ok(near(nb.memory, 0.226), "memory share " + nb.memory);
assert.ok(near(nb.equipment, 0.035), "equipment share " + nb.equipment);
assert.ok(near(nb.invest, 0.101), "invest share " + nb.invest);

// all stages positive in the latest two real positions (no downcycle in-sample)
for (const p of realMig)
  for (const s of p.stages) assert.ok(s.value > 0, p.label + "/" + s.stage + " should be positive");

// =====================================================================
// TTM self-roll (算不存, date-aligned via quarters[].period_end only, null-safe)
// =====================================================================

// helper: company with quarters
function synQ(id, years, quarters) { return { id, name: id.toUpperCase(), status: "populated", years, quarters }; }
const Q = (pe, ni) => ({ period_end: pe, label: pe, net_income: ni, sources: [] });
const FY = (fy, ni) => ({ fy, period_end: "free-text " + fy, status: "actual", revenue: 100, net_income: ni });

// ---- single add-on quarter: TTM = FY + (latest Q − year-ago Q) ----
// FY ni 100; latest Q (2026-03-31)=30, year-ago (2025-03-31)=10 → TTM = 100 + 30 − 10 = 120
const ttm1 = synQ("nvda",
  [FY("FY2025", 100)],
  [Q("2025-03-31", 10), Q("2026-03-31", 30)]);
assert.equal(Selectors.ttmNetIncome(ttm1), 120);
assert.equal(Selectors.ttmAsOf(ttm1), "2026-03-31");

// ---- multi add-on (e.g. Micron, 3 post-FY quarters): each rolled vs its year-ago twin ----
// FY ni 100; add-ons Q2,Q3,Q4 of 2026 vs 2025 twins:
//  +(12−4) +(15−5) +(20−6) = 8+10+14 = 32 → TTM = 132
const ttmMulti = synQ("micron",
  [FY("FY2025", 100)],
  [
    Q("2025-06-30", 4), Q("2025-09-30", 5), Q("2025-12-31", 6),
    Q("2026-06-30", 12), Q("2026-09-30", 15), Q("2026-12-31", 20),
  ]);
assert.equal(Selectors.ttmNetIncome(ttmMulti), 132);
assert.equal(Selectors.ttmAsOf(ttmMulti), "2026-12-31");

// ---- ±45d tolerance: NVDA-style Apr-27 (2025) vs Apr-26 (2026) still pairs ----
const ttmTol = synQ("nvda",
  [FY("FY2026", 120.1)],
  [Q("2025-04-27", 18.8), Q("2026-04-26", 58.3)]);
assert.equal(Math.round(Selectors.ttmNetIncome(ttmTol) * 10) / 10, 159.6); // 120.1 + 58.3 − 18.8

// ---- 凑不齐 → null (honest gap), each failure mode ----
// (a) no quarters
assert.equal(Selectors.ttmNetIncome(synQ("x", [FY("FY2025", 100)], [])), null);
assert.equal(Selectors.ttmNetIncome({ id: "x", status: "populated", years: [FY("FY2025", 100)] }), null);
// (b) no year-ago match for the latest quarter (only one quarter) → no add-on pair → null
assert.equal(Selectors.ttmNetIncome(synQ("x", [FY("FY2025", 100)], [Q("2026-03-31", 30)])), null);
// (c) add-on quarter net_income null → null
assert.equal(Selectors.ttmNetIncome(synQ("x", [FY("FY2025", 100)],
  [Q("2025-03-31", 10), Q("2026-03-31", null)])), null);
// (d) year-ago quarter net_income null → null
assert.equal(Selectors.ttmNetIncome(synQ("x", [FY("FY2025", 100)],
  [Q("2025-03-31", null), Q("2026-03-31", 30)])), null);
// (e) latest complete FY net_income null → null
assert.equal(Selectors.ttmNetIncome(synQ("x", [FY("FY2025", null)],
  [Q("2025-03-31", 10), Q("2026-03-31", 30)])), null);
// (f) no actual FY at all → null
assert.equal(Selectors.ttmNetIncome(synQ("x",
  [{ fy: "FY2027E", status: "forecast", revenue: 100, net_income: 50 }],
  [Q("2025-03-31", 10), Q("2026-03-31", 30)])), null);
// (g) year-ago candidate exists but OUTSIDE ±45d tolerance (e.g. 300d gap) → no pair → null
assert.equal(Selectors.ttmNetIncome(synQ("x", [FY("FY2025", 100)],
  [Q("2025-06-04", 10), Q("2026-03-31", 30)])), null); // ~300d apart, not ~365d
// null company
assert.equal(Selectors.ttmNetIncome(null), null);

// ---- negative add-on (downcycle): TTM rolls negatives without crashing ----
// FY ni 5; latest Q = −3, year-ago Q = 8 → TTM = 5 + (−3 − 8) = −6
const ttmNeg = synQ("skhynix", [FY("FY2025", 5)], [Q("2025-03-31", 8), Q("2026-03-31", -3)]);
assert.equal(Selectors.ttmNetIncome(ttmNeg), -6);

// =====================================================================
// profitPoolTTM: per-company null-safe, n count, asOfSpreadDays, stage reuse
// =====================================================================

// design=nvda, foundry=tsmc, memory=samsung+skhynix(+micron null), equipment=asml, invest=softbank(null)
const ttmCos = [
  synQ("nvda",     [FY("FY2026", 120.1)], [Q("2025-04-27", 18.8), Q("2026-04-26", 58.3)]), // TTM 159.6, asOf 2026-04-26
  synQ("tsmc",     [FY("FY2025", 50)],    [Q("2025-03-31", 10),   Q("2026-03-31", 18)]),   // TTM 58, asOf 2026-03-31
  synQ("samsung",  [FY("FY2025", 31)],    [Q("2025-03-31", 6),    Q("2026-03-31", 33)]),   // TTM 58
  synQ("skhynix",  [FY("FY2025", 30)],    [Q("2025-03-31", 6),    Q("2026-03-31", 28)]),   // TTM 52
  synQ("micron",   [FY("FY2025", 8)],     []),                                              // null → skipped
  synQ("asml",     [FY("FY2025", 10)],    [Q("2025-03-31", 2),    Q("2026-03-31", 3)]),     // TTM 11
  synQ("softbank", [FY("FY2025", 31)],    []),                                              // null → skipped
];
const ttmPool = Selectors.profitPoolTTM(ttmCos);
assert.equal(ttmPool.label, "TTM(截至各家最近季报)");
assert.equal(ttmPool.n, 5);                              // micron & softbank null → excluded
// total = 159.6 + 58 + 58 + 52 + 11 = 338.6 (micron/softbank not imputed)
assert.equal(Math.round(ttmPool.total * 10) / 10, 338.6);
// asOfSpreadDays = 2026-04-26 − 2026-03-31 = 26 days
assert.equal(ttmPool.asOfSpreadDays, 26);
// stages ordered per STAGE_ORDER (same atom as annual migration)
assert.deepEqual(ttmPool.stages.map(s => s.stage), STAGE_ORDER);
const tb = Object.fromEntries(ttmPool.stages.map(s => [s.stage, s]));
assert.equal(tb.design.value, 159.6);
assert.equal(tb.foundry.value, 58);
assert.equal(Math.round(tb.memory.value), 110);          // 58 + 52
assert.equal(tb.equipment.value, 11);
assert.equal(tb.invest.value, 0);                        // softbank null → invest empty (not imputed)
assert.equal(tb.invest.companies.length, 0);
// shares sum to 1 (positive total)
assert.ok(Math.abs(ttmPool.stages.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
// per-company traceability carries ttm + asOf
assert.deepEqual(tb.design.companies, [{ id: "nvda", name: "NVDA", ttm: 159.6, asOf: "2026-04-26" }]);
assert.deepEqual(tb.memory.companies.map(c => c.id), ["samsung", "skhynix"]);

// ---- empty / all-null pools ----
const ttmEmpty = Selectors.profitPoolTTM([]);
assert.equal(ttmEmpty.n, 0);
assert.equal(ttmEmpty.total, 0);
assert.equal(ttmEmpty.asOfSpreadDays, null);             // no contributors → null spread
const ttmAllNull = Selectors.profitPoolTTM([synQ("micron", [FY("FY2025", 8)], [])]);
assert.equal(ttmAllNull.n, 0);
assert.equal(ttmAllNull.asOfSpreadDays, null);

// ---- aggregation atom reuse consistency: same rows → same stage folding as annual ----
// Build rows identical口径 and confirm _aggregateStages matches a hand fold.
const aggRows = [{ id: "nvda", name: "N", ni: 10 }, { id: "tsmc", name: "T", ni: 20 }, { id: "asml", name: "A", ni: 5 }];
const agg = Selectors._aggregateStages(aggRows, 35);
const ab = Object.fromEntries(agg.map(s => [s.stage, s.value]));
assert.equal(ab.design, 10); assert.equal(ab.foundry, 20); assert.equal(ab.equipment, 5);
assert.equal(ab.memory, 0); assert.equal(ab.invest, 0);

// =====================================================================
// real data: head-company TTM self-roll sanity (draft scope)
// =====================================================================
const realTtm = Selectors.profitPoolTTM(Store.populated());
// recorded heads: nvda, tsmc, samsung, skhynix, asml, broadcom, micron (7);
// softbank still null (consensus 不录 → no quarters → honest null)
assert.equal(realTtm.n, 7);
assert.equal(Selectors.ttmNetIncome(Store.byId("softbank")), null);
// NVDA TTM = FY2026 120.1 + (Q1FY27 58.3 − Q1FY26 18.8) = 159.6
assert.equal(Math.round(Selectors.ttmNetIncome(Store.byId("nvda")) * 10) / 10, 159.6);
// TSMC TTM = FY2025 54.116 + (1Q26 18.12 − 1Q25 11.0) = 61.236
assert.equal(Math.round(Selectors.ttmNetIncome(Store.byId("tsmc")) * 100) / 100, 61.24);
// Broadcom TTM = FY2025 23.126 + (Q1FY26 7.349 − Q1FY25 5.503) + (Q2FY26 9.310 − Q2FY25 4.965) = 29.317
assert.equal(Math.round(Selectors.ttmNetIncome(Store.byId("broadcom")) * 1000) / 1000, 29.317);
assert.equal(Selectors.ttmAsOf(Store.byId("broadcom")), "2026-05-03");
// Micron TTM = FY2025 8.539 + (FQ1 5.24−1.87) + (FQ2 13.79−1.58) + (FQ3 28.24−1.89) = 50.469
//   真实 AI/HBM 超级周期：存储环节 TTM 暴涨，非异常值
assert.equal(Math.round(Selectors.ttmNetIncome(Store.byId("micron")) * 1000) / 1000, 50.469);
assert.equal(Selectors.ttmAsOf(Store.byId("micron")), "2026-05-28");
// asOf spread now wider: Micron 季末 2026-05-28 vs 最早 2026-03-31 = 58 天（上限 62）
assert.ok(realTtm.asOfSpreadDays >= 0 && realTtm.asOfSpreadDays <= 62, "spread " + realTtm.asOfSpreadDays);
// all recorded heads positive in current up-cycle
for (const s of realTtm.stages)
  for (const m of s.companies) assert.ok(m.ttm > 0, m.id + " ttm " + m.ttm);
// invest empty (softbank no quarters) → 0 share in TTM cross-section (coverage caveat, not imputed)
const rb = Object.fromEntries(realTtm.stages.map(s => [s.stage, s]));
assert.equal(rb.invest.companies.length, 0);
assert.equal(rb.invest.value, 0);

console.log("data-module tests passed");
