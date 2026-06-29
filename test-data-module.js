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

console.log("data-module tests passed");
