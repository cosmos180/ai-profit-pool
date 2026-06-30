const assert = require("node:assert/strict");
const data = require("./companies.json");
const { Store, Selectors } = require("./data-module.js");

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

console.log("data-module tests passed");
