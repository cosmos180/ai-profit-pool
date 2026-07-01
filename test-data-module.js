const assert = require("node:assert/strict");
const data = require("./companies.json");
const { Store, Selectors, STAGE_OF_FALLBACK, STAGE_ORDER, STAGE_LABEL, STAGE_COLOR, stageOf, _refreshStages } = require("./data-module.js");

Store._data = data;
_refreshStages(data.meta);   // derive STAGE_ORDER/LABEL/COLOR from meta.stages (Store.load does this in the browser)

assert.equal(Store.companies().length, 13);
assert.deepEqual(Store.populated().map((c) => c.id), ["nvda", "samsung", "broadcom", "softbank", "micron", "skhynix", "tsmc", "asml", "tencent", "google", "microsoft", "amazon", "oracle"]);
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

// =====================================================================
// incomeFlow: P&L left→right money flow for the FY-drill-down Sankey
// (派生自现有字段, null-safe, taxOther 带符号)
// =====================================================================

// ---- synthetic: fully-populated year, every node derivable ----
// rev 100, gross_margin .6 → grossProfit 60 / cogs 40; op 25 → opex 35; net 18 → taxOther 7
const ifFull = {
  fy: "FY1", status: "actual", revenue: 100, gross_margin: 0.6, op_income: 25, net_income: 18,
  segments: [
    { name: "AI 平台", kind: "platform", revenue: 70, is_ai: true },
    { name: "其他",   kind: "platform", revenue: 30, is_ai: false },
  ],
};
const flowFull = Selectors.incomeFlow(ifFull);
assert.equal(flowFull.revenue, 100);
assert.equal(flowFull.grossProfit, 60);          // 100 * 0.6
assert.equal(flowFull.cogs, 40);                 // 100 − 60
assert.equal(flowFull.opProfit, 25);
assert.equal(flowFull.opex, 35);                 // grossProfit 60 − op 25
assert.equal(flowFull.netIncome, 18);
assert.equal(flowFull.taxOther, 7);              // op 25 − net 18 (正=税+其他净流出)
assert.deepEqual(flowFull.has, { gross: true, opex: true, taxOther: true, segments: true });
// segments come from revenueSorted (desc), carry is_ai, [] never null
assert.deepEqual(flowFull.segments.map(s => s.name), ["AI 平台", "其他"]);
assert.equal(flowFull.segments[0].is_ai, true);
assert.equal(flowFull.segments[1].is_ai, false);

// ---- synthetic: gross_margin missing (Micron FY2023 / SoftBank shape) ----
// gross/cogs/opex 不可画, 但 segments→revenue 和 revenue→…→net 简化流仍在
const ifNoGross = {
  fy: "FY2", status: "actual", revenue: 100, gross_margin: null, op_income: 25, net_income: 18,
  segments: [{ name: "S", kind: "platform", revenue: 100, is_ai: false }],
};
const flowNoGross = Selectors.incomeFlow(ifNoGross);
assert.equal(flowNoGross.grossProfit, null);
assert.equal(flowNoGross.cogs, null);
assert.equal(flowNoGross.opex, null);            // 缺 grossProfit → opex 不可算
assert.equal(flowNoGross.has.gross, false);
assert.equal(flowNoGross.has.opex, false);
assert.equal(flowNoGross.revenue, 100);          // segments 与 revenue 仍在
assert.equal(flowNoGross.netIncome, 18);
assert.equal(flowNoGross.opProfit, 25);
assert.equal(flowNoGross.taxOther, 7);           // op/net 齐 → taxOther 仍可算
assert.equal(flowNoGross.has.taxOther, true);
assert.equal(flowNoGross.has.segments, true);

// ---- synthetic: op_income missing (SoftBank shape) → opex/opProfit/taxOther 段不可画 ----
const ifNoOp = {
  fy: "FY3", status: "actual", revenue: 100, gross_margin: 0.6, op_income: null, net_income: 30,
  segments: [{ name: "S", kind: "division", revenue: 80, is_ai: false }],
};
const flowNoOp = Selectors.incomeFlow(ifNoOp);
assert.equal(flowNoOp.opProfit, null);
assert.equal(flowNoOp.opex, null);               // 缺 op → opex 不可算
assert.equal(flowNoOp.taxOther, null);           // 缺 op → taxOther 不可算
assert.equal(flowNoOp.has.opex, false);
assert.equal(flowNoOp.has.taxOther, false);
assert.equal(flowNoOp.grossProfit, 60);          // gross 仍可画
assert.equal(flowNoOp.cogs, 40);
assert.equal(flowNoOp.has.gross, true);
assert.equal(flowNoOp.netIncome, 30);            // revenue/net 仍在
assert.equal(flowNoOp.revenue, 100);

// ---- synthetic: taxOther 负值 (net > op, 非经营收益流入, 如实带符号不取绝对值) ----
const ifNetGtOp = {
  fy: "FY4", status: "actual", revenue: 100, gross_margin: 0.6, op_income: 20, net_income: 26,
  segments: [],
};
const flowNetGtOp = Selectors.incomeFlow(ifNetGtOp);
assert.equal(flowNetGtOp.taxOther, -6);          // op 20 − net 26 = −6 (非经营净收益, 负号保留)
assert.equal(flowNetGtOp.has.taxOther, true);
assert.equal(flowNetGtOp.has.segments, false);   // 无分部 → segments 空, has.segments false
assert.deepEqual(flowNetGtOp.segments, []);

// ---- synthetic: revenue null (rare) → 整体不可用 ----
const flowNoRev = Selectors.incomeFlow({ fy: "FY5", status: "actual", revenue: null, gross_margin: 0.6, op_income: 20, net_income: 10 });
assert.equal(flowNoRev.revenue, null);
assert.deepEqual(flowNoRev.has, { gross: false, opex: false, taxOther: false, segments: false });
assert.equal(flowNoRev.grossProfit, null);
assert.equal(flowNoRev.netIncome, null);
assert.deepEqual(flowNoRev.segments, []);
// null year → 同样降级
assert.equal(Selectors.incomeFlow(null).revenue, null);
assert.equal(Selectors.incomeFlow(undefined).has.gross, false);

// ---- A2: incomeFlow segment.share（分母 = y.revenue 合并营收）----
// ifFull: rev 100, seg 70/30 → share 0.7 / 0.3（Sankey 分部支流占营收标签用）
assert.equal(flowFull.segments[0].share, 0.7);
assert.equal(flowFull.segments[1].share, 0.3);
// 零营收边界不会到这（revenue null → 整图降级、segments []），此处仅验正常口径。
// division-kind：分部和 > 营收时，incomeFlow.share 分母仍是 y.revenue（可能 >1），刻意不同于 segRevShare。
const ifDiv = {
  fy: "FYd", status: "actual", revenue: 100,
  segments: [{ name: "A", kind: "division", revenue: 80 }, { name: "B", kind: "division", revenue: 40 }],
};
const flowDiv = Selectors.incomeFlow(ifDiv);
assert.equal(flowDiv.segments[0].share, 0.8);   // 80/100（分母=营收）
assert.equal(flowDiv.segments[1].share, 0.4);   // 40/100 → 合计 1.2（division 含内部交易，符合预期）

// ---- A2: Selectors.segRevShare（分母 = revenueTotal = 分部合计，division 口径）----
// platform：分部和==营收 → 与占营收一致
assert.equal(Selectors.segRevShare(ifFull, "AI 平台"), 0.7);   // 70 / (70+30)
assert.equal(Selectors.segRevShare(ifFull, "其他"), 0.3);
// division：分母是分部合计(120)，NOT y.revenue(100) —— 与 incomeFlow.share 刻意不同
assert.equal(Selectors.segRevShare(ifDiv, "A"), 80 / 120);
assert.equal(Selectors.segRevShare(ifDiv, "B"), 40 / 120);
// 边界：分部名不存在 → null（不伪造 0）
assert.equal(Selectors.segRevShare(ifFull, "不存在"), null);
// 边界：无分部 / 零分母 → null
assert.equal(Selectors.segRevShare({ revenue: 100, segments: [] }, "X"), null);
assert.equal(Selectors.segRevShare({ revenue: 100, segments: [{ name: "Z", revenue: 0 }] }, "Z"), null); // total 0 → null

// ---- A2: Selectors.segOpMargin（op_margin 优先，否则 op_income/revenue，null 安全）----
assert.equal(Selectors.segOpMargin({ op_margin: 0.42, op_income: 10, revenue: 50 }), 0.42); // op_margin 优先（忽略回退）
assert.equal(Selectors.segOpMargin({ op_income: 20, revenue: 50 }), 0.4);                    // 回退 20/50
assert.equal(Selectors.segOpMargin({ op_income: -5, revenue: 50 }), -0.1);                   // 负利润率如实（下行周期）
assert.equal(Selectors.segOpMargin({ op_income: 10, revenue: 0 }), null);                    // 零分母 → null
assert.equal(Selectors.segOpMargin({ op_income: null, revenue: 50 }), null);                 // 缺利润 → null
assert.equal(Selectors.segOpMargin({ revenue: 50 }), null);                                  // 无 op_income 字段 → null
assert.equal(Selectors.segOpMargin(null), null);                                             // null seg → null
assert.equal(Selectors.segOpMargin({ op_margin: 0 }), 0);                                    // op_margin=0 是有效值，不被误当缺失

// ---- real data: NVDA latest actual — 全节点自洽 (grossProfit≈revenue*gross_margin) ----
const nvdaFlowY = Selectors.latestActual(Store.byId("nvda"));
const nvdaFlow = Selectors.incomeFlow(nvdaFlowY);
assert.deepEqual(nvdaFlow.has, { gross: true, opex: true, taxOther: true, segments: true });
assert.equal(nvdaFlow.revenue, nvdaFlowY.revenue);
assert.ok(Math.abs(nvdaFlow.grossProfit - nvdaFlowY.revenue * nvdaFlowY.gross_margin) < 1e-9);
assert.ok(Math.abs((nvdaFlow.grossProfit + nvdaFlow.cogs) - nvdaFlow.revenue) < 1e-9); // cogs+gross=rev
assert.equal(nvdaFlow.opProfit, nvdaFlowY.op_income);
assert.ok(Math.abs(nvdaFlow.opex - (nvdaFlow.grossProfit - nvdaFlow.opProfit)) < 1e-9);
assert.equal(nvdaFlow.netIncome, nvdaFlowY.net_income);
// taxOther = op − net, 带符号 (NVDA FY2026: op 130.39 > net 120.1 → 正, 税+其他净流出)
assert.ok(Math.abs(nvdaFlow.taxOther - (nvdaFlow.opProfit - nvdaFlow.netIncome)) < 1e-9);
assert.ok(nvdaFlow.taxOther > 0, "NVDA FY2026 op>net → taxOther 正 " + nvdaFlow.taxOther);
// 最大分部为 AI 数据中心
assert.equal(nvdaFlow.segments[0].is_ai, true);

// ---- real data: SoftBank latest actual — op_income 全 null → has.opex=false, revenue/net 仍在 ----
const sbFlowY = Selectors.latestActual(Store.byId("softbank"));
const sbFlow = Selectors.incomeFlow(sbFlowY);
assert.equal(sbFlow.has.opex, false);
assert.equal(sbFlow.opProfit, null);
assert.equal(sbFlow.opex, null);
assert.equal(sbFlow.taxOther, null);             // op null → taxOther 不可算
assert.equal(sbFlow.revenue, sbFlowY.revenue);   // revenue 仍在
assert.equal(sbFlow.netIncome, sbFlowY.net_income);

// ---- real data: Tencent latest actual (app stage) — gross 有、op_income null → has.gross=true / has.opex=false ----
const txFlowY = Selectors.latestActual(Store.byId("tencent"));
const txFlow = Selectors.incomeFlow(txFlowY);
assert.equal(txFlow.has.gross, true);            // gross_margin 已录 → 毛利可画
assert.ok(txFlow.grossProfit > 0);
assert.equal(txFlow.has.opex, false);            // op_income 留空 → opex 不可画
assert.equal(txFlow.opProfit, null);
assert.equal(txFlow.taxOther, null);             // op null → taxOther 不可算
assert.equal(txFlow.revenue, txFlowY.revenue);
assert.equal(txFlow.netIncome, txFlowY.net_income);
assert.equal(txFlow.has.segments, true);
assert.equal(txFlow.segments[0].name, "增值服务 VAS（游戏·社交网络）"); // 最大分部 = VAS
assert.equal(txFlow.segments.find(s => s.name === "网络广告 / 营销服务").is_ai, true); // 广告标 AI

// ---- real data: Micron FY2023 — gross_margin null → has.gross=false ----
const micFy23 = Selectors.yearByFy(Store.byId("micron"), "FY2023");
const micFlow = Selectors.incomeFlow(micFy23);
assert.equal(micFlow.has.gross, false);
assert.equal(micFlow.grossProfit, null);
assert.equal(micFlow.cogs, null);
assert.equal(micFlow.has.opex, false);           // 缺 grossProfit → opex 也不可画
assert.equal(micFlow.opProfit, micFy23.op_income); // op_income 有值 (−5.745)
assert.equal(micFlow.revenue, micFy23.revenue);  // revenue 仍在
assert.equal(micFlow.netIncome, micFy23.net_income);

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

// 真实数据：Tencent caveat 落地（pe=distorted 仍出值；ps/fcf_yield/ev_sales=ok 正常）
const txReal = Store.byId("tencent");
assert.equal(Selectors.valuationCaveat(txReal, "pe"), "distorted"); // 净利含投资公允价值收益 → PE 失真
assert.equal(Selectors.valuationCaveat(txReal, "ps"), "ok");
assert.equal(Selectors.valuationCaveat(txReal, "fcf_yield"), "ok");
assert.ok(Selectors.pe(txReal) > 0);               // distorted 仍出值（视图警示）
assert.ok(Selectors.ps(txReal) > 0);
assert.ok(Selectors.fcfYield(txReal) > 0);         // 有真实经营现金流 → FCF yield 有意义
assert.ok(Selectors.ev(txReal) < Selectors.marketCap(txReal)); // 净现金 → EV<市值

// ---- forward PE (NTM · consensus): price ÷ consensus_eps_value, 同币才算, 算不存 ----
// 合成：price 175 / consensus EPS 5 → 前瞻 PE 35（同币 USD）
const fwd = {
  id: "fwd", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, price: 175, price_currency: "USD", sources: [] },
  years: [
    { fy: "FY1", status: "actual", revenue: 100, net_income: 20 },
    { fy: "FY2027E", status: "forecast", revenue: 130, net_income: 30,
      consensus_eps_value: 5, consensus_eps_currency: "USD",
      consensus_eps_source: [{ label: "consensus", url: "https://x/y", data_status: "consensus" }] },
  ],
};
assert.equal(Selectors.forwardPE(fwd), 35);          // 175 / 5

// 缺 price → null
const fwdNoPrice = { ...fwd, quote: { as_of: "2026-06-26", market_cap: 200, price_currency: "USD", sources: [] } };
assert.equal(Selectors.forwardPE(fwdNoPrice), null);

// 缺 consensus_eps_value → null（现状：无数据即诚实留空）
const fwdNoEps = { id: "ne", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, price: 175, price_currency: "USD", sources: [] },
  years: [{ fy: "FY2027E", status: "forecast", revenue: 130, net_income: 30 }] };
assert.equal(Selectors.forwardPE(fwdNoEps), null);

// 缺 forecast 年（仅实际年）→ null
const fwdNoFc = { id: "nf", status: "populated",
  quote: { as_of: "2026-06-26", market_cap: 200, price: 175, price_currency: "USD", sources: [] },
  years: [{ fy: "FY1", status: "actual", revenue: 100, net_income: 20 }] };
assert.equal(Selectors.forwardPE(fwdNoFc), null);

// EPS = 0 → 零分母 → null
const fwdZeroEps = { ...fwd, years: [
  { fy: "FY2027E", status: "forecast", revenue: 130, net_income: 30, consensus_eps_value: 0, consensus_eps_currency: "USD" },
] };
assert.equal(Selectors.forwardPE(fwdZeroEps), null);

// 币种不一致（price USD, eps EUR）→ 不跨币相乘 → null
const fwdXCur = { ...fwd, years: [
  { fy: "FY2027E", status: "forecast", revenue: 130, net_income: 30,
    consensus_eps_value: 5, consensus_eps_currency: "EUR",
    consensus_eps_source: [{ label: "c", url: "https://x/y", data_status: "consensus" }] },
] };
assert.equal(Selectors.forwardPE(fwdXCur), null);

// pe caveat = na → 前瞻 PE 也 na(null)
const fwdNaCaveat = { ...fwd, valuation_caveat: { pe: "na" } };
assert.equal(Selectors.forwardPE(fwdNaCaveat), null);

// 现状真实数据：companies.json 尚无 consensus_eps_value → 全公司前瞻 PE 诚实留空(null)
for (const c of Store.populated()) {
  assert.equal(Selectors.forwardPE(c), null, `${c.id} 现无一致预期 EPS → forwardPE 应为 null`);
}

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

// ---- stage map: derived from meta.stages (ADR-1), fallback map intact ----
assert.deepEqual(STAGE_ORDER, ["design", "foundry", "memory", "equipment", "invest", "app", "cloud"]);
// STAGE_OF_FALLBACK = the former hard-coded id→stage map (still the兜底)
assert.equal(STAGE_OF_FALLBACK.nvda, "design");
assert.equal(STAGE_OF_FALLBACK.broadcom, "design");
assert.equal(STAGE_OF_FALLBACK.tsmc, "foundry");
assert.equal(STAGE_OF_FALLBACK.samsung, "memory");
assert.equal(STAGE_OF_FALLBACK.skhynix, "memory");
assert.equal(STAGE_OF_FALLBACK.micron, "memory");
assert.equal(STAGE_OF_FALLBACK.asml, "equipment");
assert.equal(STAGE_OF_FALLBACK.softbank, "invest");
assert.equal(STAGE_OF_FALLBACK.tencent, "app");
// STAGE_LABEL / STAGE_COLOR derived from meta.stages
assert.equal(STAGE_LABEL.design, "设计");
assert.equal(STAGE_LABEL.invest, "投资");
assert.equal(STAGE_LABEL.app, "应用");
assert.equal(STAGE_COLOR.design, "var(--stg-design)");   // color now flows from data, not the template
assert.equal(STAGE_COLOR.app, "var(--stg-app)");
// 新增 cloud 环节：纯数据扩展，label/color 由 meta.stages 派生（color 用直接 hex，无需改模板）
assert.equal(STAGE_LABEL.cloud, "云");
assert.equal(STAGE_COLOR.cloud, "#6E8F2A");

// stageOf: chain_stage 优先，缺则回退 STAGE_OF_FALLBACK[id]
assert.equal(stageOf({ id: "nvda" }), "design");                          // fallback by id
assert.equal(stageOf({ id: "nvda", chain_stage: "foundry" }), "foundry"); // chain_stage wins
assert.equal(stageOf({ id: "nvda", chain_stage: null }), "design");       // null chain_stage → fallback
assert.equal(stageOf({ id: "unknown-id" }), null);                        // neither knows → null

// _refreshStages: meta.stages absent → built-in constants untouched (backward-compat)
{
  const savedOrder = STAGE_ORDER.slice();
  _refreshStages(undefined);                 // no-op
  assert.deepEqual(STAGE_ORDER, savedOrder);
  _refreshStages({});                        // no stages key → no-op
  assert.deepEqual(STAGE_ORDER, savedOrder);
  // a custom meta.stages with a NEW stage + reordering by `order` is honored
  _refreshStages({ stages: [
    { key: "cloud", label: "云", color: "#abc", order: 1 },
    { key: "design", label: "设计X", color: "#def", order: 0 },
  ]});
  assert.deepEqual(STAGE_ORDER, ["design", "cloud"]);
  assert.equal(STAGE_LABEL.design, "设计X");
  assert.equal(STAGE_COLOR.cloud, "#abc");
  _refreshStages(data.meta);                 // restore canonical stages for the rest of the suite
  assert.deepEqual(STAGE_ORDER, ["design", "foundry", "memory", "equipment", "invest", "app", "cloud"]);
}

// =====================================================================
// aiShare (ADR-3 ladder): sourced → is_ai revenue proxy (division-safe) → null
// =====================================================================
function syn(id, years) { return { id, name: id.toUpperCase(), status: "populated", years }; }
const seg = (name, kind, revenue, is_ai) => ({ name, kind, revenue, is_ai });
// year with platform segments (sum == revenue)
const Ap = (fy, iso, ni, aiRev, otherRev) => ({
  fy, period_end_iso: iso, status: "actual",
  revenue: aiRev + otherRev, net_income: ni,
  segments: [seg("AI", "platform", aiRev, true), seg("其他", "platform", otherRev, false)],
});

// ---- 1) sourced: ai_profit_share wins, basis 'sourced', year-agnostic ----
{
  const c = { id: "x", ai_profit_share: 0.7, years: [Ap("FY1", "2025-01-01", 100, 90, 10)] };
  const r = Selectors.aiShare(c, Selectors.latestActual(c));
  assert.equal(r.value, 0.7); assert.equal(r.basis, "sourced"); // sourced overrides the proxy (which would be .9)
}
// ---- 2) platform proxy: AI revenue / segment sum (== revenue) ----
{
  const c = syn("x", [Ap("FY1", "2025-01-01", 100, 70, 30)]);
  const r = Selectors.aiShare(c);                 // defaults to latestActual
  assert.equal(r.value, 0.7); assert.equal(r.basis, "proxy");   // 70 / (70+30)
}
// ---- 2b) division proxy: denominator MUST be segment SUM, not y.revenue ----
// Samsung shape: segments include inter-segment sales → sum (250) > revenue (234).
{
  const y = { fy: "FY1", period_end_iso: "2025-01-01", status: "actual", revenue: 234,
    segments: [seg("DS", "division", 90, true), seg("DX", "division", 130, false), seg("SDC", "division", 30, false)] };
  const c = syn("samsung", [y]);
  const r = Selectors.aiShare(c, y);
  assert.equal(Math.round(r.value * 10000) / 10000, Math.round((90 / 250) * 10000) / 10000); // 90/250, NOT 90/234
  assert.equal(r.basis, "proxy");
}
// ---- 3) fallback B: no segments / no is_ai flag → value null (never seed from ai_exposure) ----
{
  const noSeg = syn("x", [{ fy: "FY1", status: "actual", revenue: 100, net_income: 50, segments: [] }]);
  assert.deepEqual(Selectors.aiShare(noSeg), { value: null, basis: "none" });
  const noFlag = syn("x", [{ fy: "FY1", status: "actual", revenue: 100, net_income: 50,
    segments: [{ name: "S", kind: "platform", revenue: 100 }] }]); // no is_ai key
  assert.deepEqual(Selectors.aiShare(noFlag), { value: null, basis: "none" });
  // ai_exposure='pure' must NOT auto-seed 1.0 (fallback B)
  const pure = { id: "x", ai_exposure: "pure", years: [{ fy: "FY1", status: "actual", revenue: 100, net_income: 50, segments: [] }] };
  assert.equal(Selectors.aiShare(pure).value, null);
  // no actual year / null company
  assert.equal(Selectors.aiShare({ id: "x", years: [] }).value, null);
  assert.equal(Selectors.aiShare(null).value, null);
  // zero segment-sum denominator → null (no fabricated share)
  const zeroDen = syn("x", [{ fy: "FY1", status: "actual", revenue: 0, net_income: 0,
    segments: [seg("AI", "platform", 0, true)] }]);
  assert.equal(Selectors.aiShare(zeroDen).value, null);
}

// =====================================================================
// profitPoolAI (C-weighted: Σ net_income × aiShare; null dropped, never imputed)
// =====================================================================
{
  const cos = [
    syn("nvda",     [Ap("FY1", "2025-01-01", 100, 90, 10)]),   // proxy .9 → 90
    syn("tsmc",     [Ap("FY1", "2025-01-01", 50,  30, 20)]),   // proxy .6 → 30
    { id: "x-src", name: "SRC", chain_stage: "app", ai_profit_share: 0.5,
      years: [Ap("FY1", "2025-01-01", 40, 40, 0)] },           // sourced .5 → 20 (overrides proxy 1.0)
    syn("asml",     [{ fy: "FY1", status: "actual", revenue: 100, net_income: 10, segments: [] }]), // no is_ai → dropped
    syn("softbank", [{ fy: "FY1", status: "actual", revenue: 100, net_income: 5 }]),                // no segments → dropped
  ];
  const pool = Selectors.profitPoolAI(cos);
  assert.equal(pool.N, 5);                          // 5 have comparable net income
  assert.equal(pool.n, 3);                          // 3 have a valid aiShare (asml/softbank dropped, not 0)
  assert.equal(pool.total, 140);                    // 90 + 30 + 20
  assert.deepEqual(pool.basisCount, { sourced: 1, proxy: 2 });
  assert.deepEqual(pool.byStage.map(s => s.stage), STAGE_ORDER);
  const pb = Object.fromEntries(pool.byStage.map(s => [s.stage, s]));
  assert.equal(pb.design.value, 90);               // nvda (fallback id → design)
  assert.equal(pb.foundry.value, 30);              // tsmc
  assert.equal(pb.app.value, 20);                  // x-src via chain_stage='app'
  assert.equal(pb.equipment.value, 0);             // asml dropped → empty, not imputed
  assert.equal(pb.equipment.companies.length, 0);
  // shares sum to 1
  assert.ok(Math.abs(pool.byStage.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
  // per-company traceability carries aiShare + basis
  assert.deepEqual(pb.design.companies, [{ id: "nvda", name: "NVDA", ni: 90, aiShare: 0.9, basis: "proxy" }]);
  assert.equal(pb.app.companies[0].basis, "sourced");
  // empty pool
  const empty = Selectors.profitPoolAI([]);
  assert.equal(empty.n, 0); assert.equal(empty.N, 0); assert.equal(empty.total, 0);
}

// =====================================================================
// profit-pool migration (AI-weighted, per-company coverage, n/N per position)
// =====================================================================

// ---- synthetic: per-company coverage replaces the old all-complete gate ----
// pos 0 (latest): all present; pos 1: samsung absent (1-yr) + asml has no is_ai (dropped) →
// kept anyway, with n<N reflecting partial coverage. Negative AI-weighted NI tolerated.
const synCos = [
  syn("nvda",     [Ap("FY24", "2024-01-01", 50, 45, 5), Ap("FY25", "2025-01-01", 100, 90, 10)]), // design .9
  syn("tsmc",     [Ap("FY24", "2024-01-01", 20, 12, 8), Ap("FY25", "2025-01-01", 50,  30, 20)]), // foundry .6
  syn("samsung",  [/* no pos-1 */                         Ap("FY25", "2025-01-01", 40,  20, 20)]), // memory .5
  syn("skhynix",  [Ap("FY24", "2024-01-01", -10, -10, 0),Ap("FY25", "2025-01-01", 30,  30, 0)]),  // memory 1.0 (neg pos1)
  // asml: pos0 has NO segments (no is_ai flag at all → aiShare null → dropped), pos1 has is_ai
  syn("asml",     [{ fy: "FY24", period_end_iso: "2024-01-01", status: "actual", revenue: 10, net_income: 6, segments: [] },
                   Ap("FY25", "2025-01-01", 10, 4, 6)]),                                           // equipment .4
];
const synMig = Selectors.profitPoolMigration(synCos);
assert.equal(synMig.length, 2);                    // both positions kept (no gate)
const newest = synMig[synMig.length - 1];          // pos 0 = ≈2025
const oldest = synMig[0];                           // pos 1 = ≈2024
assert.equal(newest.label, "≈2025");
assert.equal(oldest.label, "≈2024");
// newest: all 5 have comparable year & valid aiShare → n=N=5
assert.equal(newest.N, 5); assert.equal(newest.n, 5);
// total = 90 + 30 + 20 + 30 + 4 = 174 (AI-weighted)
assert.equal(newest.total, 174);
const nb = Object.fromEntries(newest.stages.map(s => [s.stage, s]));
assert.equal(nb.design.value, 90);
assert.equal(nb.foundry.value, 30);
assert.equal(nb.memory.value, 50);                 // samsung 20 + skhynix 30
assert.equal(nb.equipment.value, 4);
assert.ok(Math.abs(newest.stages.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
// oldest (pos 1): samsung absent (only 1 yr) → not in coverage. nvda/tsmc/skhynix/asml HAVE
// a year here → N=4; asml lacks is_ai → no aiShare → dropped from contributors → n=3.
// present contributors: nvda(45), tsmc(12), skhynix(-10, negative folded in).
assert.equal(oldest.N, 4); assert.equal(oldest.n, 3);
assert.equal(oldest.total, 47);                    // 45 + 12 + (-10)
const ob = Object.fromEntries(oldest.stages.map(s => [s.stage, s]));
assert.equal(ob.memory.value, -10);                // skhynix only, negative, no crash
assert.equal(ob.equipment.value, 0);              // asml dropped → empty
assert.equal(ob.equipment.companies.length, 0);

// ---- synthetic: a position where ALL drop (no is_ai anywhere) → position omitted ----
const synAllDrop = [
  syn("nvda", [{ fy: "FY25", period_end_iso: "2025-01-01", status: "actual", revenue: 100, net_income: 50, segments: [] }]),
  syn("tsmc", [{ fy: "FY25", period_end_iso: "2025-01-01", status: "actual", revenue: 100, net_income: 50 }]),
];
assert.deepEqual(Selectors.profitPoolMigration(synAllDrop), []); // no valid aiShare → nothing to show
assert.deepEqual(Selectors.profitPoolMigration([]), []);

// ---- synthetic: chain_stage overrides fallback id-map in the migration ----
{
  const c = [{ id: "nvda", name: "NVDA", chain_stage: "app", status: "populated",
    years: [Ap("FY25", "2025-01-01", 100, 100, 0)] }]; // nvda re-tagged app via chain_stage
  const m = Selectors.profitPoolMigration(c);
  const mb = Object.fromEntries(m[0].stages.map(s => [s.stage, s.value]));
  assert.equal(mb.app, 100);                        // landed in app, not design
  assert.equal(mb.design, 0);
}

// ---- synthetic: year alignment prefers period_end_iso, falls back to period_end regex ----
{
  // period_end_iso says 2025; the free-text period_end says 2099 (would mislead the regex)
  const c = [syn("nvda", [{ fy: "FY25", period_end_iso: "2025-06-30", period_end: "截至 2099",
    status: "actual", revenue: 100, net_income: 50, segments: [seg("AI", "platform", 100, true)] }])];
  assert.equal(Selectors.profitPoolMigration(c)[0].label, "≈2025"); // iso wins over free-text
  // no iso → fall back to free-text regex
  const c2 = [syn("nvda", [{ fy: "FY25", period_end: "自然年 2024",
    status: "actual", revenue: 100, net_income: 50, segments: [seg("AI", "platform", 100, true)] }])];
  assert.equal(Selectors.profitPoolMigration(c2)[0].label, "≈2024");
}

// ---- real data: AI-weighted migration, per-company coverage, n/N ----
const realMig = Selectors.profitPoolMigration(Store.populated());
assert.equal(realMig.length, 3);                 // gate removed → ≈2023 / ≈2024 / ≈2025
const realNew = realMig[realMig.length - 1];
assert.equal(realNew.label, "≈2025");
assert.equal(realNew.n, 13); assert.equal(realNew.N, 13); // all 13 contribute at latest position
// ≈2023 position: samsung 2-yr only + oracle 最早 FY2024（无 2023）→ 两家不在该年覆盖 → N=12
assert.equal(realMig[0].label, "≈2023");
assert.equal(realMig[0].N, 12); assert.equal(realMig[0].n, 12);

// hero/migration consistency: newest migration total == profitPoolAI total (same C口径)
const aiPool = Selectors.profitPoolAI(Store.populated());
assert.ok(Math.abs(realNew.total - aiPool.total) < 1e-9, "migration newest == AI pool total");
assert.equal(aiPool.n, 13); assert.equal(aiPool.N, 13);
assert.deepEqual(aiPool.basisCount, { sourced: 0, proxy: 13 }); // current data: all proxy

// =====================================================================
// profitPoolLeader / profitPoolYoY (Home hero 组合派生,下沉自旧 renderHome 内联算术)
// =====================================================================
{
  // leader: 用上面的合成池(nvda 90 / tsmc 30 / x-src 20;total 140)——龙头 nvda 占 90/140。
  const cos = [
    syn("nvda",     [Ap("FY1", "2025-01-01", 100, 90, 10)]),   // proxy .9 → 90
    syn("tsmc",     [Ap("FY1", "2025-01-01", 50,  30, 20)]),   // proxy .6 → 30
    { id: "x-src", name: "SRC", chain_stage: "app", ai_profit_share: 0.5,
      years: [Ap("FY1", "2025-01-01", 40, 40, 0)] },           // sourced .5 → 20
  ];
  const ld = Selectors.profitPoolLeader(cos);
  assert.equal(ld.leader.id, "nvda");
  assert.equal(ld.pool, 140);
  assert.ok(Math.abs(ld.share - 90 / 140) < 1e-9);
  assert.equal(ld.n, 3); assert.equal(ld.N, 3);
  assert.deepEqual(ld.basisCount, { sourced: 1, proxy: 2 });
  // 空池 → leader/share null,不崩、不伪造 0
  const empty = Selectors.profitPoolLeader([]);
  assert.equal(empty.leader, null); assert.equal(empty.share, null); assert.equal(empty.pool, 0);
}
{
  // yoy: 两位置 total 25→174(用上面的 synCos)→ (174-25.? )... 直接用 synMig 的两位置。
  const yy = Selectors.profitPoolYoY(synCos);
  assert.equal(yy.migLast.label, "≈2025"); assert.equal(yy.migPrev.label, "≈2024");
  assert.ok(Math.abs(yy.value - (yy.migLast.total - yy.migPrev.total) / yy.migPrev.total) < 1e-9);
  // 上一位置 total ≤0 → 基期无意义 → value null(不可比)。Ap(fy,iso,ni,aiRev,otherRev):
  // FY24 ni=-10、aiRev=10(aiShare=1.0)→ migPrev.total=-10;FY25 ni=30 → migLast.total=30。
  const negPrev = [
    syn("skhynix", [Ap("FY24", "2024-01-01", -10, 10, 0), Ap("FY25", "2025-01-01", 30, 30, 0)]),
  ];
  assert.equal(Selectors.profitPoolYoY(negPrev).value, null);
  // 不足两位置 → null
  const one = [syn("nvda", [Ap("FY1", "2025-01-01", 100, 90, 10)])];
  assert.equal(Selectors.profitPoolYoY(one).value, null);
  assert.deepEqual(Selectors.profitPoolYoY([]), { value: null, migLast: null, migPrev: null });
}
// real data: leader == 池龙头,yoy 口径自洽(与迁移图两位置一致)
{
  const ld = Selectors.profitPoolLeader(Store.populated());
  assert.ok(ld.share > 0 && ld.share <= 1, "leader share in (0,1]: " + ld.share);
  assert.ok(Math.abs(ld.pool - aiPool.total) < 1e-9, "leader pool == AI pool total");
  const yy = Selectors.profitPoolYoY(Store.populated());
  assert.ok(Math.abs(yy.value - (realNew.total - realMig[realMig.length - 2].total) / realMig[realMig.length - 2].total) < 1e-9);
}

// shares sum to 1 at the latest position
assert.ok(Math.abs(realNew.stages.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);

// TRUE AI-weighted shares under current data (C口径). 加 4 家 hyperscaler(google/microsoft/
// amazon/oracle, chain_stage='cloud')后新增 cloud 环节：尽管四家净利合计巨大,但其 AI 占比
// (云分部营收/总营收,约 15–38%/oracle 77%)远低于上游纯 AI 厂 → C 加权后 cloud 仅 ~27.6%,
// 被显著折算,正是"整公司≠全 AI"的验证。
const rnb = Object.fromEntries(realNew.stages.map(s => [s.stage, s.share]));
const near = (a, b) => Math.abs(a - b) <= 0.005; // ±0.5pp
assert.ok(near(rnb.design, 0.416), "design share " + rnb.design);
assert.ok(near(rnb.foundry, 0.110), "foundry share " + rnb.foundry);
assert.ok(near(rnb.memory, 0.153), "memory share " + rnb.memory);
assert.ok(near(rnb.equipment, 0.013), "equipment share " + rnb.equipment);
assert.ok(near(rnb.invest, 0.009), "invest share " + rnb.invest);
assert.ok(near(rnb.app, 0.024), "app share " + rnb.app);
assert.ok(near(rnb.cloud, 0.276), "cloud share " + rnb.cloud);   // 新环节: 4 家 hyperscaler 折算后占比

// ≈2023 has a memory downcycle → negative stage value tolerated (no crash, view renders neg)
assert.ok(realMig[0].stages.find(s => s.stage === "memory").value < 0, "2023 memory AI-weighted negative");

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
// profitPoolTTM: AI-weighted, per-company null-safe, n count, asOfSpreadDays, stage reuse
//   ni = ttmNetIncome × aiShare.value, 与 profitPoolAI/profitPoolMigration 同口径 (ADR-3)。
//   aiShare 来自公司级 ai_profit_share(synAI 注入)；缺则 DROP(不计 0)。
// =====================================================================

// synthetic helper that pins a company-level ai_profit_share (sourced basis) so
// aiShare(c).value is deterministic — mirrors the real proxy path which all TTM heads have.
const synAI = (id, share, years, quarters) => ({ ...synQ(id, years, quarters), ai_profit_share: share });

// design=nvda, foundry=tsmc, memory=samsung+skhynix(+micron null), equipment=asml, invest=softbank(null)
const ttmCos = [
  synAI("nvda",     1.0, [FY("FY2026", 120.1)], [Q("2025-04-27", 18.8), Q("2026-04-26", 58.3)]), // TTM 159.6 ×1.0 = 159.6, asOf 2026-04-26
  synAI("tsmc",     0.5, [FY("FY2025", 50)],    [Q("2025-03-31", 10),   Q("2026-03-31", 18)]),   // TTM 58 ×0.5 = 29, asOf 2026-03-31
  synAI("samsung",  0.5, [FY("FY2025", 31)],    [Q("2025-03-31", 6),    Q("2026-03-31", 33)]),   // TTM 58 ×0.5 = 29
  synAI("skhynix",  1.0, [FY("FY2025", 30)],    [Q("2025-03-31", 6),    Q("2026-03-31", 28)]),   // TTM 52 ×1.0 = 52
  synAI("micron",   0.5, [FY("FY2025", 8)],     []),                                              // ttm null → skipped (aiShare irrelevant)
  synAI("asml",     0.4, [FY("FY2025", 10)],    [Q("2025-03-31", 2),    Q("2026-03-31", 3)]),     // TTM 11 ×0.4 = 4.4
  synAI("softbank", 0.1, [FY("FY2025", 31)],    []),                                              // ttm null → skipped
];
const ttmPool = Selectors.profitPoolTTM(ttmCos);
assert.equal(ttmPool.label, "TTM(AI 加权,截至各家最近季报)");
assert.equal(ttmPool.n, 5);                              // micron & softbank ttm null → excluded
// total = 159.6 + 29 + 29 + 52 + 4.4 = 274.0 (AI-weighted; micron/softbank not imputed)
assert.equal(Math.round(ttmPool.total * 10) / 10, 274.0);
// asOfSpreadDays = 2026-04-26 − 2026-03-31 = 26 days (unaffected by weighting)
assert.equal(ttmPool.asOfSpreadDays, 26);
// stages ordered per STAGE_ORDER (same atom as annual migration)
assert.deepEqual(ttmPool.stages.map(s => s.stage), STAGE_ORDER);
const tb = Object.fromEntries(ttmPool.stages.map(s => [s.stage, s]));
assert.equal(Math.round(tb.design.value * 10) / 10, 159.6);   // nvda 159.6 ×1.0
assert.equal(tb.foundry.value, 29);                           // tsmc 58 ×0.5
assert.equal(Math.round(tb.memory.value * 10) / 10, 81);      // samsung 29 + skhynix 52
assert.ok(Math.abs(tb.equipment.value - 4.4) < 1e-9);        // asml 11 ×0.4
assert.equal(tb.invest.value, 0);                            // softbank null → invest empty (not imputed)
assert.equal(tb.invest.companies.length, 0);
// shares sum to 1 (positive total)
assert.ok(Math.abs(ttmPool.stages.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
// per-company traceability carries weighted ttm + asOf + aiShare
assert.deepEqual(tb.design.companies, [{ id: "nvda", name: "NVDA", ttm: 159.6, asOf: "2026-04-26", aiShare: 1.0 }]);
assert.deepEqual(tb.memory.companies.map(c => c.id), ["samsung", "skhynix"]);
assert.deepEqual(tb.memory.companies.map(c => c.aiShare), [0.5, 1.0]);

// ---- AI-weighting drops a company whose aiShare is null (has TTM but no share) ----
// synQ (no ai_profit_share, no is_ai segments) → aiShare.value null → DROP, never counted as 0.
const ttmShareNull = Selectors.profitPoolTTM([
  synAI("nvda", 1.0, [FY("FY2026", 100)], [Q("2025-04-27", 10), Q("2026-04-26", 30)]), // ttm 120, share 1 → 120
  synQ("tsmc",       [FY("FY2025", 50)],  [Q("2025-03-31", 10), Q("2026-03-31", 18)]), // ttm 58, share null → DROP
]);
assert.equal(ttmShareNull.n, 1);                         // tsmc dropped for null aiShare (not 0-counted)
assert.equal(ttmShareNull.total, 120);                   // only nvda contributes
const tsb = Object.fromEntries(ttmShareNull.stages.map(s => [s.stage, s]));
assert.equal(tsb.foundry.value, 0);                      // tsmc absent, not imputed
assert.equal(tsb.foundry.companies.length, 0);

// ---- empty / all-null pools ----
const ttmEmpty = Selectors.profitPoolTTM([]);
assert.equal(ttmEmpty.n, 0);
assert.equal(ttmEmpty.total, 0);
assert.equal(ttmEmpty.asOfSpreadDays, null);             // no contributors → null spread
const ttmAllNull = Selectors.profitPoolTTM([synAI("micron", 0.5, [FY("FY2025", 8)], [])]);
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
// 全 7 家都有 is_ai 代理 → aiShare 非 null,AI 加权不会额外剔除任何一家,n 仍 7。
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
// ---- AI-weighted total/stages (vs former full-amount $423.5B) ----
// 各家 weighted = ttm × aiShare(latestActual is_ai proxy):
//   nvda 159.6×0.8972=143.19 + broadcom 29.317×0.5769=16.91 → design 160.11
//   tsmc 61.236×0.59=36.13 → foundry; samsung 58.561×0.3577 + micron 50.469×0.3618
//   + skhynix 52.887×1.0 = 92.10 → memory; asml 11.408×0.3552=4.05 → equipment
// total ≈ 292.38 (全额口径曾为 423.48 → 加权后显著收口,与三根年度柱可比)
assert.ok(Math.abs(realTtm.total - 292.383) < 0.5, "ttm AI total " + realTtm.total);
assert.ok(realTtm.total < 423, "AI-weighted TTM must be below full-amount $423B: " + realTtm.total);
const rwb = Object.fromEntries(realTtm.stages.map(s => [s.stage, s]));
assert.ok(Math.abs(rwb.design.value    - 160.11) < 0.5, "design "    + rwb.design.value);
assert.ok(Math.abs(rwb.foundry.value   -  36.13) < 0.5, "foundry "   + rwb.foundry.value);
assert.ok(Math.abs(rwb.memory.value    -  92.10) < 0.5, "memory "    + rwb.memory.value);
assert.ok(Math.abs(rwb.equipment.value -   4.05) < 0.5, "equipment " + rwb.equipment.value);
// per-company traceability now carries the AI share used
assert.ok(rwb.design.companies.every(m => m.aiShare != null && m.aiShare > 0));
// all recorded heads positive in current up-cycle (weighted)
for (const s of realTtm.stages)
  for (const m of s.companies) assert.ok(m.ttm > 0, m.id + " ttm " + m.ttm);
// invest empty (softbank no quarters) → 0 share in TTM cross-section (coverage caveat, not imputed)
const rb = Object.fromEntries(realTtm.stages.map(s => [s.stage, s]));
assert.equal(rb.invest.companies.length, 0);
assert.equal(rb.invest.value, 0);

// =====================================================================
// B1: stageValuationRel — same-stage relative valuation (comps)
//   cohort = 同 stageOf 的 populated 公司里该指标可比者(排除 na/distorted/null);
//   relative ∈ low/mid/high 指数值相对中位数(±15% 带);cohortN<3 → insufficient;
//   本公司自身 na/distorted/null → 无相对位置(insufficient, value=null)。
//   注入合成 Store._data 后跑,末尾恢复真实数据。
// =====================================================================
{
  const realData = data;   // 保存真实数据引用,末尾恢复
  const y1 = (rev, ni) => ({ fy: "FY1", status: "actual", revenue: rev, net_income: ni });
  // 便捷构造:同 chain_stage、有市值 → pe/ps 可算;可选 caveat
  const vc = (id, stage, mcap, rev, ni, caveat) => ({
    id, name: id.toUpperCase(), status: "populated", chain_stage: stage,
    quote: { as_of: "2026-06-26", market_cap: mcap, sources: [] },
    valuation_caveat: caveat || undefined,
    years: [y1(rev, ni)],
  });

  // memory 环节 5 家 PS: 值 = mcap/rev → 1,2,3,4,5 → median 3
  const memCohort = [
    vc("m1", "memory", 100, 100, 10),  // ps 1
    vc("m2", "memory", 200, 100, 10),  // ps 2
    vc("m3", "memory", 300, 100, 10),  // ps 3 (median)
    vc("m4", "memory", 400, 100, 10),  // ps 4
    vc("m5", "memory", 500, 100, 10),  // ps 5
  ];
  Store._data = { meta: realData.meta, companies: memCohort };
  _refreshStages(realData.meta);

  // m1 ps=1 < 3×0.85=2.55 → low(数值低);lowerCheaper=true → 视图判"更便宜"
  const r1 = Selectors.stageValuationRel(Store.byId("m1"), "ps");
  assert.equal(r1.cohortN, 5);
  assert.equal(r1.median, 3);
  assert.equal(r1.value, 1);
  assert.equal(r1.relative, "low");
  assert.equal(r1.lowerCheaper, true);
  assert.equal(r1.insufficient, false);
  // m3 ps=3 == median → mid(居中)
  assert.equal(Selectors.stageValuationRel(Store.byId("m3"), "ps").relative, "mid");
  // m5 ps=5 > 3×1.15=3.45 → high(数值高 → 更贵)
  assert.equal(Selectors.stageValuationRel(Store.byId("m5"), "ps").relative, "high");
  // 带内:ps=3.4 (< 3.45) → mid;ps=2.6 (> 2.55) → mid(±15% 带内均居中)
  Store._data = { meta: realData.meta, companies: [
    vc("b1", "memory", 260, 100, 10), vc("b2", "memory", 340, 100, 10),
    vc("b3", "memory", 300, 100, 10), vc("b4", "memory", 300, 100, 10),
    vc("b5", "memory", 300, 100, 10),
  ] };
  assert.equal(Selectors.stageValuationRel(Store.byId("b1"), "ps").relative, "mid"); // 2.6 在带内
  assert.equal(Selectors.stageValuationRel(Store.byId("b2"), "ps").relative, "mid"); // 3.4 在带内

  // ---- 方向语义:fcfYield 越高越便宜 → lowerCheaper=false ----
  // fcfYield = fcf/mcap;fcf = cfo−capex。构造 5 家 yield: .01 .02 .03 .04 .05 → median .03
  const fy = (rev, ni, capex, cfo) => ({ fy: "FY1", status: "actual", revenue: rev, net_income: ni, capex, cfo });
  const fc = (id, mcap, cfo) => ({ id, name: id.toUpperCase(), status: "populated", chain_stage: "memory",
    quote: { as_of: "2026-06-26", market_cap: mcap, sources: [] }, years: [fy(100, 10, 0, cfo)] });
  Store._data = { meta: realData.meta, companies: [
    fc("f1", 100, 1), fc("f2", 100, 2), fc("f3", 100, 3), fc("f4", 100, 4), fc("f5", 100, 5),
  ] };
  const rf = Selectors.stageValuationRel(Store.byId("f1"), "fcfYield");
  assert.equal(rf.lowerCheaper, false);          // fcfYield 高才便宜
  assert.equal(Math.round(rf.median * 1000) / 1000, 0.03);
  assert.equal(rf.value, 0.01);
  assert.equal(rf.relative, "low");              // 数值低(0.01<0.03×0.85)→ 视图据 lowerCheaper=false 判"更贵"
  assert.equal(Selectors.stageValuationRel(Store.byId("f5"), "fcfYield").relative, "high"); // 高 → 更便宜

  // ---- 排除 na/distorted:不进 cohort、不算入 median ----
  // 3 家有效(ps 1,2,3 → median 2)+ 1 家 distorted + 1 家 na → cohortN 应为 3
  Store._data = { meta: realData.meta, companies: [
    vc("e1", "memory", 100, 100, 10),                                  // ps 1
    vc("e2", "memory", 200, 100, 10),                                  // ps 2
    vc("e3", "memory", 300, 100, 10),                                  // ps 3
    vc("edist", "memory", 900, 100, 10, { ps: "distorted" }),          // distorted → 排除(即便值 9)
    vc("ena", "memory", 800, 100, 10, { ps: "na" }),                   // na → 排除(值本就 null)
  ] };
  const re = Selectors.stageValuationRel(Store.byId("e1"), "ps");
  assert.equal(re.cohortN, 3);                    // distorted/na 未计入
  assert.equal(re.median, 2);                     // median of 1,2,3(不含 9)
  assert.equal(re.value, 1);
  assert.equal(re.relative, "low");
  // 本公司自身 distorted → 无相对位置(insufficient, value=null),但仍报 cohortN/median 供上下文
  const rdist = Selectors.stageValuationRel(Store.byId("edist"), "ps");
  assert.equal(rdist.value, null);
  assert.equal(rdist.relative, null);
  assert.equal(rdist.insufficient, true);
  assert.equal(rdist.cohortN, 3);                 // cohort 仍是 3 家有效同伴
  // 本公司自身 na → 同样无相对位置
  const rna = Selectors.stageValuationRel(Store.byId("ena"), "ps");
  assert.equal(rna.value, null);
  assert.equal(rna.relative, null);
  assert.equal(rna.insufficient, true);

  // ---- 小样本 insufficient:有效 cohortN<3 → 不给 relative(即便本公司有值)----
  Store._data = { meta: realData.meta, companies: [
    vc("s1", "memory", 100, 100, 10),   // ps 1
    vc("s2", "memory", 200, 100, 10),   // ps 2 —— 仅 2 家有效
  ] };
  const rs = Selectors.stageValuationRel(Store.byId("s1"), "ps");
  assert.equal(rs.cohortN, 2);
  assert.equal(rs.insufficient, true);
  assert.equal(rs.relative, null);
  assert.equal(rs.value, 1);                       // 本公司值仍报(视图可显数,只是不给相对位置)

  // ---- 独家环节:cohortN=1(只有自己)→ insufficient ----
  Store._data = { meta: realData.meta, companies: [
    vc("solo", "equipment", 100, 100, 10),
    vc("other", "memory", 200, 100, 10),
  ] };
  const rsolo = Selectors.stageValuationRel(Store.byId("solo"), "ps");
  assert.equal(rsolo.cohortN, 1);
  assert.equal(rsolo.insufficient, true);
  assert.equal(rsolo.relative, null);

  // ---- null 安全:null 公司 / 未知 key / 无 stage ----
  assert.equal(Selectors.stageValuationRel(null, "ps").insufficient, true);
  assert.equal(Selectors.stageValuationRel(null, "ps").value, null);
  const rbad = Selectors.stageValuationRel(Store.byId("solo"), "unknown");
  assert.equal(rbad.insufficient, true);
  assert.equal(rbad.value, null);
  assert.equal(rbad.lowerCheaper, null);          // 未知 key → lowerCheaper null
  const rnostage = Selectors.stageValuationRel({ id: "no-stage", status: "populated",
    quote: { market_cap: 100, sources: [] }, years: [y1(100, 10)] }, "ps");
  assert.equal(rnostage.insufficient, true);      // stageOf null → 无 cohort

  // ---- 恢复真实数据,给后续/复跑一个干净状态 ----
  Store._data = realData;
  _refreshStages(realData.meta);

  // ---- 真实数据:存储环节(memory: samsung/skhynix/micron)PS 相对位置自洽 ----
  const micronRel = Selectors.stageValuationRel(Store.byId("micron"), "ps");
  assert.ok(micronRel.cohortN >= 3, "memory ps cohort >=3: " + micronRel.cohortN);
  assert.equal(micronRel.insufficient, false);
  assert.ok(["low", "mid", "high"].includes(micronRel.relative));
  assert.equal(micronRel.lowerCheaper, true);
  assert.ok(micronRel.value != null && micronRel.median != null);
  // 真实数据:softbank pe=na → 无相对位置;ps=distorted → 无相对位置
  assert.equal(Selectors.stageValuationRel(Store.byId("softbank"), "pe").value, null);
  assert.equal(Selectors.stageValuationRel(Store.byId("softbank"), "pe").insufficient, true);
  assert.equal(Selectors.stageValuationRel(Store.byId("softbank"), "ps").insufficient, true);
  // 真实数据:tencent pe=distorted → 无相对位置(即便有值)
  const txPeRel = Selectors.stageValuationRel(Store.byId("tencent"), "pe");
  assert.equal(txPeRel.value, null);
  assert.equal(txPeRel.insufficient, true);
}

console.log("data-module tests passed");
