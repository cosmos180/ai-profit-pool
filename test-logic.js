// test-logic.js — 数据无关的纯逻辑回归测试（合成数据）。
// 覆盖 Selectors/Store 的纯函数行为、边界、null 降级、负值、零分母。
// **永不因 companies.json 数据刷新而改**；真实数据的快照对账见 test-snapshot.js。
// CJS：node 与 bun 都可直接跑，也可被 test-data-module.js 薄壳 require。
const assert = require("node:assert/strict");
const { Store, Selectors, STAGE_OF_FALLBACK, STAGE_ORDER, STAGE_LABEL, STAGE_COLOR, stageOf, _refreshStages } = require("./data-module.js");

// 规范环节表（镜像 companies.json meta.stages 的契约，架构师所有）——让依赖 STAGE_ORDER
// 的合成池测试自洽，无需加载任何真实财务数据。若架构师改环节契约，这里同步（属契约变更，
// 非数据刷新）。
const CANON_META = { stages: [
  { key: "design",    label: "设计", color: "var(--stg-design)",    order: 0 },
  { key: "foundry",   label: "代工", color: "var(--stg-foundry)",   order: 1 },
  { key: "memory",    label: "存储", color: "var(--stg-memory)",    order: 2 },
  { key: "equipment", label: "设备", color: "var(--stg-equipment)", order: 3 },
  { key: "invest",    label: "投资", color: "var(--stg-invest)",    order: 4 },
  { key: "cloud",     label: "云",   color: "#6E8F2A",              order: 65 },
  { key: "app",       label: "应用", color: "var(--stg-app)",       order: 5 },
]};
Store._data = { meta: CANON_META, companies: [] };
_refreshStages(CANON_META);

// ---- Store.byId 未命中 → undefined（不伪造）----
assert.equal(Store.byId("missing-company"), undefined);

// ---- latestActual / forecastYear / homeMetric 降级 ----
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
assert.equal(Selectors.homeMetric(forecastOnly, "unknown"), null);

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

// ---- synthetic: period-style records store gross_profit, not gross_margin ----
// Quarterly periods ingest disclosed gross profit directly; the Sankey selector must
// treat that as first-class input instead of downgrading the flow as missing gross.
const ifGrossProfitOnly = {
  period_id: "q-gp", kind: "quarter", status: "actual",
  revenue: 100, gross_profit: 62, gross_margin: null, op_income: 25, net_income: 18,
};
const flowGrossProfitOnly = Selectors.incomeFlow(ifGrossProfitOnly);
assert.equal(flowGrossProfitOnly.grossProfit, 62);
assert.equal(flowGrossProfitOnly.cogs, 38);
assert.equal(flowGrossProfitOnly.opex, 37);
assert.equal(flowGrossProfitOnly.has.gross, true);
assert.equal(flowGrossProfitOnly.has.opex, true);

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

// =====================================================================
// valuation: PE / PS / FCF yield (derived from quote vs latest actual; never stored)
// =====================================================================
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

// =====================================================================
// forward PE (NTM · consensus): price ÷ consensus_eps_value, 同币才算, 算不存
// =====================================================================
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

// =====================================================================
// stage map: STAGE_OF_FALLBACK 常量（data-module 内建，数据无关）+ 派生自 meta.stages
// =====================================================================
// STAGE_ORDER 派生自 meta.stages（按 order 升序）——用 CANON_META 验证派生机制
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
// cloud 环节：label/color 由 meta.stages 派生（color 用直接 hex，无需改模板）
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
  _refreshStages(CANON_META);                // restore canonical stages for the rest of the suite
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

// ---- synthetic: year alignment uses period_end_iso only; free-text period_end is display text ----
{
  // period_end_iso says 2025; the free-text period_end says 2099 (would mislead the regex)
  const c = [syn("nvda", [{ fy: "FY25", period_end_iso: "2025-06-30", period_end: "截至 2099",
    status: "actual", revenue: 100, net_income: 50, segments: [seg("AI", "platform", 100, true)] }])];
  assert.equal(Selectors.profitPoolMigration(c)[0].label, "≈2025"); // iso wins over free-text
  // no iso → null; never parse free-text period_end
  const c2 = [syn("nvda", [{ fy: "FY25", period_end: "自然年 2024",
    status: "actual", revenue: 100, net_income: 50, segments: [seg("AI", "platform", 100, true)] }])];
  assert.equal(Selectors._yearOf(c2[0].years[0]), null);
}

// =====================================================================
// profitPoolLeader / profitPoolYoY (Home hero 组合派生)
// =====================================================================
{
  // leader: 用合成池(nvda 90 / tsmc 30 / x-src 20;total 140)——龙头 nvda 占 90/140。
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
  // yoy: 两位置 total(用上面的 synCos)——(migLast−migPrev)/migPrev
  const yy = Selectors.profitPoolYoY(synCos);
  assert.equal(yy.migLast.label, "≈2025"); assert.equal(yy.migPrev.label, "≈2024");
  assert.ok(Math.abs(yy.value - (yy.migLast.total - yy.migPrev.total) / yy.migPrev.total) < 1e-9);
  // 上一位置 total ≤0 → 基期无意义 → value null(不可比)。
  const negPrev = [
    syn("skhynix", [Ap("FY24", "2024-01-01", -10, 10, 0), Ap("FY25", "2025-01-01", 30, 30, 0)]),
  ];
  assert.equal(Selectors.profitPoolYoY(negPrev).value, null);
  // 不足两位置 → null
  const one = [syn("nvda", [Ap("FY1", "2025-01-01", 100, 90, 10)])];
  assert.equal(Selectors.profitPoolYoY(one).value, null);
  assert.deepEqual(Selectors.profitPoolYoY([]), { value: null, migLast: null, migPrev: null });
}

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

// revenue/op guidance without net_income is traceable but ignored by net-income TTM/asOf
const ttmRevenueOnlyLatest = synQ("samsung",
  [FY("FY2025", 100)],
  [Q("2025-03-31", 10), Q("2026-03-31", 30),
   { period_end: "2026-06-30", label: "Q2 guidance", net_income: null, revenue: 120, op_income: 60, sources: [] }]);
assert.equal(Selectors.ttmNetIncome(ttmRevenueOnlyLatest), 120);
assert.equal(Selectors.ttmAsOf(ttmRevenueOnlyLatest), "2026-03-31");

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
// (c) add-on quarter net_income null → ignored; no complete net-income pair → null
assert.equal(Selectors.ttmNetIncome(synQ("x", [FY("FY2025", 100)],
  [Q("2025-03-31", 10), Q("2026-03-31", null)])), null);
// (d) year-ago quarter net_income null → ignored; no complete net-income pair → null
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

// synthetic helpers that pin a company-level ai_profit_share (sourced basis) so
// aiShare(c).value is deterministic — mirrors the real proxy path which all TTM heads have.
const synAI = (id, share, years, quarters) => ({ ...synQ(id, years, quarters), ai_profit_share: share });
const ttmPeriod = (period_id, period_end, calendar_year, calendar_quarter, net_income) => ({
  period_id, kind: "quarter", status: "actual", period_start: null, period_end,
  calendar_year, calendar_quarter, fiscal_year: "FYX", fiscal_quarter: calendar_quarter,
  revenue: 100, net_income, segments: [], sources: [],
});
const synPeriodAI = (id, share, vals, ends) => ({
  id, status: "populated", name: id.toUpperCase(), ai_profit_share: share,
  years: [FY("FY2026", vals.reduce((s, v) => s + v, 0))],
  periods: vals.map((v, i) => ttmPeriod(
    `${id}-q${i + 1}`, ends[i][0], ends[i][1], ends[i][2], v
  )),
});

// design=nvda, foundry=tsmc, memory=samsung+skhynix(+micron null), equipment=asml, invest=softbank(null)
const ttmCos = [
  synPeriodAI("nvda", 1.0, [20, 30, 51.3, 58.3], [
    ["2025-07-27", 2025, "Q3"], ["2025-10-26", 2025, "Q4"], ["2026-01-25", 2026, "Q1"], ["2026-04-26", 2026, "Q2"],
  ]), // TTM 159.6 ×1.0 = 159.6, asOf 2026-04-26
  synPeriodAI("tsmc", 0.5, [10, 12, 18, 18], [
    ["2025-06-30", 2025, "Q2"], ["2025-09-30", 2025, "Q3"], ["2025-12-31", 2025, "Q4"], ["2026-03-31", 2026, "Q1"],
  ]), // TTM 58 ×0.5 = 29, asOf 2026-03-31
  synPeriodAI("samsung", 0.5, [6, 8, 11, 33], [
    ["2025-06-30", 2025, "Q2"], ["2025-09-30", 2025, "Q3"], ["2025-12-31", 2025, "Q4"], ["2026-03-31", 2026, "Q1"],
  ]), // TTM 58 ×0.5 = 29
  synPeriodAI("skhynix", 1.0, [6, 8, 10, 28], [
    ["2025-06-30", 2025, "Q2"], ["2025-09-30", 2025, "Q3"], ["2025-12-31", 2025, "Q4"], ["2026-03-31", 2026, "Q1"],
  ]), // TTM 52 ×1.0 = 52
  synAI("micron",   0.5, [FY("FY2025", 8)],     []), // no periods → skipped (aiShare irrelevant)
  synPeriodAI("asml", 0.4, [2, 2, 4, 3], [
    ["2025-06-30", 2025, "Q2"], ["2025-09-30", 2025, "Q3"], ["2025-12-31", 2025, "Q4"], ["2026-03-31", 2026, "Q1"],
  ]), // TTM 11 ×0.4 = 4.4
  synAI("softbank", 0.1, [FY("FY2025", 31)],    []), // no periods → skipped
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
// per-company traceability carries weighted ttm + asOf + aiShare + basis (Phase 6 final: periods-only)
assert.deepEqual(tb.design.companies, [{ id: "nvda", name: "NVDA", ttm: 159.6, asOf: "2026-04-26", aiShare: 1.0, basis: "periods" }]);
assert.deepEqual(tb.memory.companies.map(c => c.id), ["samsung", "skhynix"]);
assert.deepEqual(tb.memory.companies.map(c => c.aiShare), [0.5, 1.0]);
assert.deepEqual(ttmPool.basisCount, { periods: 5 });  // 5 contributors, all periods
assert.ok(ttmPool.stages.flatMap(s => s.companies).every(c => c.basis === "periods"));

// ---- AI-weighting drops a company whose aiShare is null (has TTM but no share) ----
// synQ (no ai_profit_share, no is_ai segments) → aiShare.value null → DROP, never counted as 0.
const ttmShareNull = Selectors.profitPoolTTM([
  synPeriodAI("nvda", 1.0, [20, 30, 40, 30], [
    ["2025-07-27", 2025, "Q3"], ["2025-10-26", 2025, "Q4"], ["2026-01-25", 2026, "Q1"], ["2026-04-26", 2026, "Q2"],
  ]), // ttm 120, share 1 → 120
  { ...synPeriodAI("tsmc", null, [10, 12, 18, 18], [
    ["2025-06-30", 2025, "Q2"], ["2025-09-30", 2025, "Q3"], ["2025-12-31", 2025, "Q4"], ["2026-03-31", 2026, "Q1"],
  ]), ai_profit_share: undefined }, // ttm 58, share null → DROP
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
// B1: stageValuationRel — same-stage relative valuation (comps), 合成 cohort
//   cohort = 同 stageOf 的 populated 公司里该指标可比者(排除 na/distorted/null);
//   relative ∈ low/mid/high 指数值相对中位数(±15% 带);cohortN<3 → insufficient;
//   本公司自身 na/distorted/null → 无相对位置(insufficient, value=null)。
//   注入合成 Store._data 后跑,末尾恢复空壳状态。
// =====================================================================
{
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
  Store._data = { meta: CANON_META, companies: memCohort };
  _refreshStages(CANON_META);

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
  Store._data = { meta: CANON_META, companies: [
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
  Store._data = { meta: CANON_META, companies: [
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
  Store._data = { meta: CANON_META, companies: [
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
  Store._data = { meta: CANON_META, companies: [
    vc("s1", "memory", 100, 100, 10),   // ps 1
    vc("s2", "memory", 200, 100, 10),   // ps 2 —— 仅 2 家有效
  ] };
  const rs = Selectors.stageValuationRel(Store.byId("s1"), "ps");
  assert.equal(rs.cohortN, 2);
  assert.equal(rs.insufficient, true);
  assert.equal(rs.relative, null);
  assert.equal(rs.value, 1);                       // 本公司值仍报(视图可显数,只是不给相对位置)

  // ---- 独家环节:cohortN=1(只有自己)→ insufficient ----
  Store._data = { meta: CANON_META, companies: [
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

  // ---- 恢复空壳状态,给后续/复跑一个干净起点 ----
  Store._data = { meta: CANON_META, companies: [] };
  _refreshStages(CANON_META);
}

// =====================================================================
// Period-base layer (period-base refactor · Phase 2): periods/actualPeriods/
// quarterPeriods/latestQuarter/periodCoverage/calendarYear/ttmFromPeriods/
// fiscalYearFromPeriods. 合成数据、数据无关；覆盖乱序输入、guidance 可见性、
// 缺司安全、三缺一、guidance 不补全、财年错位 CY 正确、annual 胜 quarter_sum、
// 以及 legacy quarters[] 合成 status="actual" 的 Phase 3.1 边界。
// =====================================================================
{
  // period 构造器：默认 quarter/actual/USD，o 覆盖任意字段
  const P = (o) => ({
    kind: "quarter", status: "actual", period_start: null,
    fiscal_year: null, fiscal_quarter: null, currency: "USD", fx_to_usd: 1,
    revenue: null, gross_profit: null, op_income: null, net_income: null,
    cfo: null, capex: null, segments: [], sources: [], ...o,
  });

  // ---- periods(): 排序无视输入顺序 ----
  const pc = { id: "pc", status: "populated", periods: [
    P({ period_id: "q3", period_end: "2025-09-30", calendar_year: 2025, calendar_quarter: "Q3", net_income: 3 }),
    P({ period_id: "q1", period_end: "2025-03-31", calendar_year: 2025, calendar_quarter: "Q1", net_income: 1 }),
    P({ period_id: "q2", period_end: "2025-06-30", calendar_year: 2025, calendar_quarter: "Q2", net_income: 2 }),
  ]};
  assert.deepEqual(Selectors.periods(pc).map(p => p.period_id), ["q1", "q2", "q3"]); // oldest→newest

  // ---- guidance visible to periods()/quarterPeriods() but NOT actualPeriods()/latestQuarter() ----
  const pg = { id: "pg", status: "populated", periods: [
    P({ period_id: "a", period_end: "2026-03-31", calendar_year: 2026, calendar_quarter: "Q1", net_income: 10, revenue: 90 }),
    P({ period_id: "g", period_end: "2026-06-30", calendar_year: 2026, calendar_quarter: "Q2",
        status: "guidance", net_income: null, revenue: 120, op_income: 60 }),
  ]};
  assert.equal(Selectors.periods(pg).length, 2);           // guidance visible
  assert.equal(Selectors.quarterPeriods(pg).length, 2);
  assert.equal(Selectors.actualPeriods(pg).length, 1);     // guidance excluded
  assert.equal(Selectors.latestQuarter(pg).period_id, "a"); // latestQuarter skips guidance

  // ---- missing / empty company safe ----
  assert.deepEqual(Selectors.periods(null), []);
  assert.deepEqual(Selectors.periods({}), []);
  assert.deepEqual(Selectors.actualPeriods(null), []);
  assert.equal(Selectors.latestQuarter(null), null);
  assert.equal(Selectors.latestQuarter({ id: "e", quarters: [] }), null);

  // ---- synth from legacy quarters[]: status ALWAYS actual; calendar_quarter from DATE MATH ----
  const legacy = { id: "lg", status: "populated", quarters: [
    { period_end: "2026-04-26", label: "Q1 FY2027", net_income: 58.3, sources: [] },
    { period_end: "2025-04-27", label: "Q1 FY2026", net_income: 18.8, sources: [] },
  ]};
  const lp = Selectors.periods(legacy);
  assert.equal(lp.length, 2);
  assert.equal(lp[0].period_end, "2025-04-27");            // sorted oldest first
  assert.equal(lp[0].status, "actual");                    // legacy → always actual
  assert.equal(lp[0].calendar_quarter, "Q2");              // Apr → Q2 (date math), NOT label 'Q1'
  assert.equal(lp[0].calendar_year, 2025);
  assert.equal(lp[0]._synth, true);
  assert.equal(Selectors.latestQuarter(legacy).period_end, "2026-04-26");

  // ---- Phase 3.1 边界：legacy quarters[] 里三星 Q2'26 guidance 原子（net_income=null,有 rev/op）----
  // 无 status 字段 → 合成为 status="actual"，故被 latestQuarter 选中。Phase 3.1 把三星转成真
  // periods[]（status="guidance"）后不再当 actual；UI 到 Phase 4 才接 periods[]，当前无可见影响。
  const samsungLegacy = { id: "samsung", status: "populated", quarters: [
    { period_end: "2025-03-31", label: "Q1 2025", net_income: 5.78, sources: [] },
    { period_end: "2026-03-31", label: "Q1 2026", net_income: 33.21, revenue: 94.18, sources: [] },
    { period_end: "2026-06-30", label: "Q2 2026 earnings guidance", net_income: null, revenue: 120.27, op_income: 62.88, sources: [] },
  ]};
  const slq = Selectors.latestQuarter(samsungLegacy);
  assert.equal(slq.period_end, "2026-06-30");              // guidance atom synthesized as actual → picked (边界)
  assert.equal(slq.status, "actual");
  assert.equal(slq.net_income, null);                      // has rev/op → still a financial fact

  // ---- periodCoverage ----
  const cov = Selectors.periodCoverage(pg, "ttm");
  assert.equal(cov.view, "ttm");
  assert.equal(cov.source, "periods");
  assert.equal(cov.total, 2);
  assert.equal(cov.actualQuarters, 1);
  assert.equal(cov.guidanceQuarters, 1);
  assert.equal(cov.annual, 0);
  assert.equal(cov.latestQuarterEnd, "2026-03-31");
  const covLegacy = Selectors.periodCoverage(legacy);
  assert.equal(covLegacy.source, "quarters");
  assert.equal(covLegacy.view, null);
  assert.equal(covLegacy.actualQuarters, 2);
  const covEmpty = Selectors.periodCoverage(null);
  assert.equal(covEmpty.total, 0);
  assert.equal(covEmpty.latestQuarterEnd, null);

  // =====================================================================
  // calendarYear(c, year)
  // =====================================================================
  // ---- four actual quarters sum correctly ----
  const cyc = { id: "cyc", status: "populated", periods: [
    P({ period_id: "q1", period_end: "2025-03-31", calendar_year: 2025, calendar_quarter: "Q1", revenue: 10, op_income: 3, net_income: 2, cfo: 4, capex: 1, sources: [{ label: "a", url: "https://x/1", data_status: "official" }] }),
    P({ period_id: "q2", period_end: "2025-06-30", calendar_year: 2025, calendar_quarter: "Q2", revenue: 20, op_income: 6, net_income: 4, cfo: 8, capex: 2 }),
    P({ period_id: "q3", period_end: "2025-09-30", calendar_year: 2025, calendar_quarter: "Q3", revenue: 30, op_income: 9, net_income: 6, cfo: 12, capex: 3 }),
    P({ period_id: "q4", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", revenue: 40, op_income: 12, net_income: 8, cfo: 16, capex: 4 }),
  ]};
  const cy = Selectors.calendarYear(cyc, 2025);
  assert.equal(cy.complete, true);
  assert.deepEqual(cy.missing, []);
  assert.equal(cy.revenue, 100); assert.equal(cy.op_income, 30);
  assert.equal(cy.net_income, 20); assert.equal(cy.cfo, 40); assert.equal(cy.capex, 10);
  assert.equal(cy.label, "CY2025"); assert.equal(cy.year, 2025); assert.equal(cy.basis, "periods");
  assert.equal(cy.sources.length, 1);                      // provenance aggregated from the quarters
  // 严格 CY: cyc 四季 period_start 均为 null (P() 默认) → 无法验证覆盖 → strict=false (proxy)
  assert.equal(cy.strict, false);
  assert.equal(cy.coverage_start, null);
  assert.deepEqual(cy.coverage, { Q1: "actual", Q2: "actual", Q3: "actual", Q4: "actual" });

  // ---- three quarters → incomplete with missing quarter list, metrics null ----
  const cy3 = Selectors.calendarYear({ id: "x", periods: [
    P({ period_id: "q1", period_end: "2025-03-31", calendar_year: 2025, calendar_quarter: "Q1", revenue: 10, net_income: 2 }),
    P({ period_id: "q2", period_end: "2025-06-30", calendar_year: 2025, calendar_quarter: "Q2", revenue: 20, net_income: 4 }),
    P({ period_id: "q4", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", revenue: 40, net_income: 8 }),
  ]}, 2025);
  assert.equal(cy3.complete, false);
  assert.deepEqual(cy3.missing, ["Q3"]);
  assert.equal(cy3.revenue, null);                         // incomplete → metrics null
  assert.equal(cy3.net_income, null);

  // ---- guidance Q4 does NOT complete a calendar year ----
  const cyG = Selectors.calendarYear({ id: "x", periods: [
    P({ period_id: "q1", period_end: "2025-03-31", calendar_year: 2025, calendar_quarter: "Q1", revenue: 10, net_income: 2 }),
    P({ period_id: "q2", period_end: "2025-06-30", calendar_year: 2025, calendar_quarter: "Q2", revenue: 20, net_income: 4 }),
    P({ period_id: "q3", period_end: "2025-09-30", calendar_year: 2025, calendar_quarter: "Q3", revenue: 30, net_income: 6 }),
    P({ period_id: "q4g", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", status: "guidance", revenue: 40, net_income: null }),
  ]}, 2025);
  assert.equal(cyG.complete, false);                       // guidance Q4 excluded → Q4 missing
  assert.deepEqual(cyG.missing, ["Q4"]);
  assert.equal(cyG.net_income, null);

  // ---- fiscal-year-shifted company with four CALENDAR quarters → correct CY ----
  // fiscal labels span FY2025/FY2026, but calendar tags align to CY2025 → CY keys off
  // calendar_year/calendar_quarter, never fiscal_year.
  const shifted = { id: "shift", periods: [
    P({ period_id: "s1", period_end: "2025-03-31", calendar_year: 2025, calendar_quarter: "Q1", fiscal_year: "FY2025", fiscal_quarter: "Q3", revenue: 10, net_income: 2 }),
    P({ period_id: "s2", period_end: "2025-06-30", calendar_year: 2025, calendar_quarter: "Q2", fiscal_year: "FY2025", fiscal_quarter: "Q4", revenue: 20, net_income: 4 }),
    P({ period_id: "s3", period_end: "2025-09-30", calendar_year: 2025, calendar_quarter: "Q3", fiscal_year: "FY2026", fiscal_quarter: "Q1", revenue: 30, net_income: 6 }),
    P({ period_id: "s4", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", fiscal_year: "FY2026", fiscal_quarter: "Q2", revenue: 40, net_income: 8 }),
  ]};
  const cyShift = Selectors.calendarYear(shifted, 2025);
  assert.equal(cyShift.complete, true);
  assert.equal(cyShift.revenue, 100);                      // correct CY despite fiscal shift
  assert.equal(cyShift.net_income, 20);

  // ---- all four calendar quarters present (complete) but ONE metric has a gap → that metric null ----
  const cyGap = Selectors.calendarYear({ id: "gap", periods: [
    P({ period_id: "q1", period_end: "2025-03-31", calendar_year: 2025, calendar_quarter: "Q1", revenue: 10, cfo: 4 }),
    P({ period_id: "q2", period_end: "2025-06-30", calendar_year: 2025, calendar_quarter: "Q2", revenue: 20, cfo: null }),
    P({ period_id: "q3", period_end: "2025-09-30", calendar_year: 2025, calendar_quarter: "Q3", revenue: 30, cfo: 12 }),
    P({ period_id: "q4", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", revenue: 40, cfo: 16 }),
  ]}, 2025);
  assert.equal(cyGap.complete, true);                      // quarter coverage complete
  assert.equal(cyGap.revenue, 100);                        // revenue all present → summed
  assert.equal(cyGap.cfo, null);                           // one quarter's cfo missing → metric null

  // ---- null-safe ----
  assert.equal(Selectors.calendarYear(null, 2025).complete, false);
  assert.equal(Selectors.calendarYear({ id: "e" }, 2025).complete, false);
  assert.deepEqual(Selectors.calendarYear({ id: "e" }, 2025).missing, ["Q1", "Q2", "Q3", "Q4"]);

  // =====================================================================
  // ttmFromPeriods(c, metric)
  // =====================================================================
  const ttmBase = [
    P({ period_id: "q1", period_end: "2025-06-30", calendar_year: 2025, calendar_quarter: "Q2", revenue: 10, net_income: 2 }),
    P({ period_id: "q2", period_end: "2025-09-30", calendar_year: 2025, calendar_quarter: "Q3", revenue: 20, net_income: 4 }),
    P({ period_id: "q3", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", revenue: 30, net_income: 6 }),
    P({ period_id: "q4", period_end: "2026-03-31", calendar_year: 2026, calendar_quarter: "Q1", revenue: 40, net_income: 8 }),
  ];
  const ttmP = { id: "t", periods: ttmBase };
  const tni = Selectors.ttmFromPeriods(ttmP, "net_income");
  assert.equal(tni.value, 20); assert.equal(tni.complete, true);
  assert.equal(tni.quarters, 4); assert.equal(tni.asOf, "2026-03-31");
  assert.equal(tni.contiguous, true); assert.equal(tni.gap, null); // Q2→Q3→Q4→Q1 连续 12 个月
  assert.equal(Selectors.ttmFromPeriods(ttmP, "revenue").value, 100);

  // ---- 连续性校验：最新四季不连号（美股财年末季系统性缺失，如微软缺 calendar-Q2）→ null + gap ----
  // 不静默把横跨 13 个月的 Q1,Q3,Q4,Q1 当 TTM 相加（留空也比填错好；FY 锚定 ttmNetIncome 才是 fallback）。
  const msftShape = { id: "msft", status: "populated", periods: [
    P({ period_id: "q1a", period_end: "2025-03-31", calendar_year: 2025, calendar_quarter: "Q1", net_income: 25 }),
    P({ period_id: "q3",  period_end: "2025-09-30", calendar_year: 2025, calendar_quarter: "Q3", net_income: 27 }), // 缺 Q2 (2025-06)
    P({ period_id: "q4",  period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", net_income: 38 }),
    P({ period_id: "q1b", period_end: "2026-03-31", calendar_year: 2026, calendar_quarter: "Q1", net_income: 31 }),
  ]};
  const ms = Selectors.ttmFromPeriods(msftShape, "net_income");
  assert.equal(ms.value, null);            // 不连续 → 不给错值
  assert.equal(ms.complete, false);
  assert.equal(ms.contiguous, false);
  assert.equal(ms.quarters, 4);
  assert.match(ms.gap, /2025-03-31.*2025-09-30.*缺 1 季/); // 缺口精确指向 Q1 与 Q3 之间

  // ---- fiscal-year-shifted 连号仍成立：NVDA Apr/Jul/Oct/Jan → Q2,Q3,Q4,Q1 连续 ----
  const nvdaShape = { id: "nvda2", status: "populated", periods: [
    P({ period_id: "fq1", period_end: "2025-04-30", calendar_year: 2025, calendar_quarter: "Q2", net_income: 10 }),
    P({ period_id: "fq2", period_end: "2025-07-31", calendar_year: 2025, calendar_quarter: "Q3", net_income: 12 }),
    P({ period_id: "fq3", period_end: "2025-10-31", calendar_year: 2025, calendar_quarter: "Q4", net_income: 14 }),
    P({ period_id: "fq4", period_end: "2026-01-31", calendar_year: 2026, calendar_quarter: "Q1", net_income: 16 }),
  ]};
  const nv = Selectors.ttmFromPeriods(nvdaShape, "net_income");
  assert.equal(nv.value, 52); assert.equal(nv.contiguous, true); assert.equal(nv.gap, null); // 财年错位不影响连号

  // ---- five quarters → uses LATEST four (drops oldest), not anchored to latestActual ----
  const ttm5 = { id: "t5", periods: [
    P({ period_id: "q0", period_end: "2025-03-31", calendar_year: 2025, calendar_quarter: "Q1", net_income: 100 }),
    ...ttmBase,
  ]};
  assert.equal(Selectors.ttmFromPeriods(ttm5, "net_income").value, 20); // latest 4 only

  // ---- guidance-only latest quarter ignored (not in actualPeriods) ----
  const ttmG = { id: "tg", periods: [
    ...ttmBase,
    P({ period_id: "g", period_end: "2026-06-30", calendar_year: 2026, calendar_quarter: "Q2", status: "guidance", net_income: null, revenue: 120 }),
  ]};
  const tg = Selectors.ttmFromPeriods(ttmG, "net_income");
  assert.equal(tg.value, 20);                              // guidance ignored → still the 4 actual quarters
  assert.equal(tg.asOf, "2026-03-31");

  // ---- missing metric in one of the latest four → null, no crash ----
  const ttmMiss = { id: "tm", periods: [
    P({ period_id: "q1", period_end: "2025-06-30", calendar_year: 2025, calendar_quarter: "Q2", net_income: 2 }),
    P({ period_id: "q2", period_end: "2025-09-30", calendar_year: 2025, calendar_quarter: "Q3", net_income: null }),
    P({ period_id: "q3", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", net_income: 6 }),
    P({ period_id: "q4", period_end: "2026-03-31", calendar_year: 2026, calendar_quarter: "Q1", net_income: 8 }),
  ]};
  const tmr = Selectors.ttmFromPeriods(ttmMiss, "net_income");
  assert.equal(tmr.value, null); assert.equal(tmr.complete, false); assert.equal(tmr.quarters, 4);
  assert.equal(tmr.contiguous, true); assert.equal(tmr.gap, null); // 连号成立，仅指标缺一季 → 非缺口

  // ---- fewer than four quarters → null + coverage ----
  const ttm2 = { id: "t2", periods: [
    P({ period_id: "q1", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", net_income: 6 }),
    P({ period_id: "q2", period_end: "2026-03-31", calendar_year: 2026, calendar_quarter: "Q1", net_income: 8 }),
  ]};
  const t2 = Selectors.ttmFromPeriods(ttm2, "net_income");
  assert.equal(t2.value, null); assert.equal(t2.complete, false);
  assert.equal(t2.quarters, 2); assert.equal(t2.asOf, "2026-03-31");
  assert.equal(t2.contiguous, false); assert.equal(t2.gap, null); // 不足四季是覆盖不足，非缺口
  const t0 = Selectors.ttmFromPeriods({ id: "z" }, "net_income");
  assert.equal(t0.value, null); assert.equal(t0.quarters, 0); assert.equal(t0.asOf, null);
  // synth-from-quarters path also feeds ttmFromPeriods (all actual)
  assert.equal(Selectors.ttmFromPeriods(legacy, "net_income").quarters, 2);

  // =====================================================================
  // fiscalYearFromPeriods(c, fy)
  // =====================================================================
  const fyQuarters = [
    P({ period_id: "q1", period_end: "2025-03-31", calendar_year: 2025, calendar_quarter: "Q1", fiscal_year: "FY2025", revenue: 10, net_income: 2 }),
    P({ period_id: "q2", period_end: "2025-06-30", calendar_year: 2025, calendar_quarter: "Q2", fiscal_year: "FY2025", revenue: 20, net_income: 4 }),
    P({ period_id: "q3", period_end: "2025-09-30", calendar_year: 2025, calendar_quarter: "Q3", fiscal_year: "FY2025", revenue: 30, net_income: 6 }),
    P({ period_id: "q4", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", fiscal_year: "FY2025", revenue: 40, net_income: 8 }),
  ];
  // ---- annual official beats quarter sum ----
  const fyA = Selectors.fiscalYearFromPeriods({ id: "fyco", periods: [
    P({ period_id: "a", kind: "annual", calendar_quarter: null, period_end: "2025-12-31", calendar_year: 2025, fiscal_year: "FY2025", revenue: 99, net_income: 20,
        sources: [{ label: "10-K", url: "https://x/k", data_status: "official" }] }),
    ...fyQuarters,
  ]}, "FY2025");
  assert.equal(fyA.basis, "annual_report");
  assert.equal(fyA.revenue, 99);                           // annual official (99), NOT quarter sum (100)
  assert.equal(fyA.net_income, 20);
  assert.equal(fyA.complete, true);
  assert.equal(fyA.sources.length, 1);

  // ---- quarter sum works when annual missing ----
  const fyQ = Selectors.fiscalYearFromPeriods({ id: "fyq", periods: fyQuarters }, "FY2025");
  assert.equal(fyQ.basis, "quarter_sum");
  assert.equal(fyQ.complete, true);
  assert.equal(fyQ.revenue, 100);                          // sum of the four quarters
  assert.equal(fyQ.net_income, 20);
  assert.equal(fyQ.quarters, 4);

  // ---- mixed actual/guidance quarters do NOT produce a completed fiscal year ----
  const fyMix = Selectors.fiscalYearFromPeriods({ id: "fym", periods: [
    ...fyQuarters.slice(0, 3),
    P({ period_id: "q4g", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4", fiscal_year: "FY2025", status: "guidance", revenue: 40, net_income: null }),
  ]}, "FY2025");
  assert.equal(fyMix.basis, "quarter_sum");
  assert.equal(fyMix.complete, false);                     // only 3 actual quarters → incomplete
  assert.equal(fyMix.quarters, 3);
  assert.equal(fyMix.revenue, null);                       // incomplete → metrics null

  // ---- null-safe ----
  assert.equal(Selectors.fiscalYearFromPeriods(null, "FY2025").basis, null);
  const fyNone = Selectors.fiscalYearFromPeriods({ id: "e" }, "FY2099");
  assert.equal(fyNone.complete, false); assert.equal(fyNone.quarters, 0);

  // =====================================================================
  // impliedQ4(c, fy) —— annual − (fiscal Q1+Q2+Q3), 默认策略 (用户拍板 2026-07-07)
  // 全部硬约束满足→出值+basis; 缺 annual/缺一季/口径不一→null; 逐指标缺→该指标 null;
  // 分部同 key 集才推, 否则 []。
  // =====================================================================
  // 年度 + 三季 (自然年, USD, fx=1); 每指标 annual − Σ(Q1..Q3)
  const AN = P({
    period_id: "annual25", kind: "annual", calendar_quarter: null,
    period_start: "2025-01-01", period_end: "2025-12-31", calendar_year: 2025,
    fiscal_year: "FY2025", fiscal_quarter: null,
    revenue: 100, gross_profit: 60, op_income: 30, net_income: 20, cfo: 40, capex: 10,
    segments: [{ name: "A", kind: "platform", revenue: 60, is_ai: true }, { name: "B", kind: "platform", revenue: 40, is_ai: false }],
    sources: [{ label: "10-K", url: "https://x/k", data_status: "official" }],
  });
  const FQ = (fq, pe, ps, rev, gp, op, ni, cfo, capex, segs) => P({
    period_id: "fy25" + fq, period_end: pe, period_start: ps, calendar_year: 2025,
    calendar_quarter: fq, fiscal_year: "FY2025", fiscal_quarter: fq,
    revenue: rev, gross_profit: gp, op_income: op, net_income: ni, cfo, capex,
    segments: segs || [], sources: [{ label: fq, url: "https://x/" + fq, data_status: "official" }],
  });
  const q1 = FQ("Q1", "2025-03-31", "2025-01-01", 10, 6, 3, 2, 4, 1, [{ name: "A", kind: "platform", revenue: 6, is_ai: true }, { name: "B", kind: "platform", revenue: 4 }]);
  const q2 = FQ("Q2", "2025-06-30", "2025-04-01", 20, 12, 6, 4, 8, 2, [{ name: "A", kind: "platform", revenue: 12, is_ai: true }, { name: "B", kind: "platform", revenue: 8 }]);
  const q3 = FQ("Q3", "2025-09-30", "2025-07-01", 30, 18, 9, 6, 12, 3, [{ name: "A", kind: "platform", revenue: 18, is_ai: true }, { name: "B", kind: "platform", revenue: 12 }]);
  const iqCo = { id: "iq", status: "populated", periods: [AN, q1, q2, q3] };
  const iq = Selectors.impliedQ4(iqCo, "FY2025");
  assert.equal(iq.basis, "implied_q4");
  assert.equal(iq.confidence, "derived_from_official");
  assert.equal(iq.kind, "quarter"); assert.equal(iq.fiscal_quarter, "Q4");
  assert.equal(iq.revenue, 40);        // 100 − (10+20+30)
  assert.equal(iq.gross_profit, 24);   // 60 − (6+12+18)
  assert.equal(iq.op_income, 12);      // 30 − (3+6+9)
  assert.equal(iq.net_income, 8);      // 20 − (2+4+6)
  assert.equal(iq.cfo, 16);            // 40 − (4+8+12)
  assert.equal(iq.capex, 4);           // 10 − (1+2+3)
  assert.equal(iq.period_start, "2025-10-01");  // Q3 末 2025-09-30 +1 天 (链内推导)
  assert.equal(iq.period_end, "2025-12-31");    // = annual 财年末
  assert.equal(iq.calendar_year, 2025);
  assert.equal(iq.calendar_quarter, "Q4");      // date math of 12-31
  assert.equal(iq.sources.length, 4);           // annual + Q1 + Q2 + Q3 provenance 拼接
  // 分部 Q4: 同 key 集 {A,B} → 逐分部推 revenue
  assert.deepEqual(iq.segments.map(s => s.name).sort(), ["A", "B"]);
  const segA = iq.segments.find(s => s.name === "A"), segB = iq.segments.find(s => s.name === "B");
  assert.equal(segA.revenue, 24);      // 60 − (6+12+18)
  assert.equal(segA.is_ai, true);
  assert.equal(segB.revenue, 16);      // 40 − (4+8+12)

  // ---- 缺 annual → null ----
  assert.equal(Selectors.impliedQ4({ id: "x", periods: [q1, q2, q3] }, "FY2025"), null);
  // ---- 缺一季 (Q2) → null ----
  assert.equal(Selectors.impliedQ4({ id: "x", periods: [AN, q1, q3] }, "FY2025"), null);
  // ---- guidance 季不算 actual → 视为缺季 → null ----
  const q2g = Object.assign({}, q2, { status: "guidance" });
  assert.equal(Selectors.impliedQ4({ id: "x", periods: [AN, q1, q2g, q3] }, "FY2025"), null);
  // ---- 口径不一: 某季 currency 不同 → null ----
  const q2krw = Object.assign({}, q2, { currency: "KRW", fx_to_usd: 1421.779 });
  assert.equal(Selectors.impliedQ4({ id: "x", periods: [AN, q1, q2krw, q3] }, "FY2025"), null);
  // ---- 口径不一: fx 不同 → null ----
  const q2fx = Object.assign({}, q2, { fx_to_usd: 2 });
  assert.equal(Selectors.impliedQ4({ id: "x", periods: [AN, q1, q2fx, q3] }, "FY2025"), null);
  // ---- 逐指标缺: annual 缺 cfo → 该指标 null, 其余照算 ----
  const AN_noCfo = Object.assign({}, AN, { cfo: null });
  const iqNoCfo = Selectors.impliedQ4({ id: "x", periods: [AN_noCfo, q1, q2, q3] }, "FY2025");
  assert.equal(iqNoCfo.cfo, null);
  assert.equal(iqNoCfo.net_income, 8);  // 其余不受影响
  // ---- 分部 key 集不一致 → segments [] (绝不推部分/臆造分部) ----
  const q3diff = FQ("Q3", "2025-09-30", "2025-07-01", 30, 18, 9, 6, 12, 3, [{ name: "C", kind: "platform", revenue: 30 }]);
  const iqSegDiff = Selectors.impliedQ4({ id: "x", periods: [AN, q1, q2, q3diff] }, "FY2025");
  assert.deepEqual(iqSegDiff.segments, []);
  assert.equal(iqSegDiff.revenue, 40);  // 顶层可加指标仍推
  // ---- null-safe ----
  assert.equal(Selectors.impliedQ4(null, "FY2025"), null);
  assert.equal(Selectors.impliedQ4(iqCo, null), null);

  // ---- 微软案例守卫: annual 在 years[] 而非 periods[] → impliedQ4 只从 periods[] 取 annual,
  //      periods() 从 quarters[] 合成全是 kind=quarter (无 annual) → 不误触发 → null ----
  const msftLike = { id: "msft2", status: "populated",
    years: [{ fy: "FY2025", status: "actual", revenue: 100, net_income: 20 }],
    quarters: [
      { period_end: "2025-03-31", label: "Q1", net_income: 2, sources: [] },
      { period_end: "2025-06-30", label: "Q2", net_income: 4, sources: [] },
      { period_end: "2025-09-30", label: "Q3", net_income: 6, sources: [] },
    ] };
  assert.equal(Selectors.impliedQ4(msftLike, "FY2025"), null);   // years[] annual 不被 impliedQ4 看见
  assert.equal(Selectors.ttmFromPeriods(msftLike, "net_income").usedImpliedQ4, false);

  // ---- NVDA 型守卫 (1 月末财年): fiscal Q1 (period_end 4 月末) 的 calendar_quarter=Q2, FY≠CY;
  //      annual 落 calendar Q1 (1 月末); 仅一个 fiscal Q1 → 无 Q2/Q3 → impliedQ4 null →
  //      CY 只点亮 calendar Q2 槽, 绝不用 FY 冒充 CY, latestQuarter 走该季而非 annual。----
  const nvdaLike = { id: "nvdalike", status: "populated", periods: [
    P({ period_id: "nl-fy26-annual", kind: "annual", calendar_quarter: null,
      period_start: "2025-01-27", period_end: "2026-01-25", calendar_year: 2026,
      fiscal_year: "FY2026", fiscal_quarter: null, revenue: 215.94, net_income: 120.1 }),
    P({ period_id: "nl-fy26q1", period_start: "2025-01-27", period_end: "2025-04-27",
      calendar_year: 2025, calendar_quarter: "Q2", fiscal_year: "FY2026", fiscal_quarter: "Q1",
      revenue: null, net_income: 18.8 }),
  ] };
  const nlq1 = Selectors.periods(nvdaLike).find(p => p.fiscal_quarter === "Q1");
  assert.equal(nlq1.calendar_quarter, "Q2");                       // 4 月末 → 自然年 Q2
  assert.notEqual(nlq1.calendar_year, Number(nlq1.fiscal_year.slice(2))); // CY2025 ≠ FY2026
  assert.equal(Selectors.impliedQ4(nvdaLike, "FY2026"), null);     // 无 Q2/Q3 → 不派 implied
  const nlCY = Selectors.calendarYear(nvdaLike, 2025);
  assert.equal(nlCY.complete, false);
  assert.deepEqual(nlCY.coverage, { Q2: "actual" });               // 只 calendar Q2 槽, 无 FY 冒充
  assert.deepEqual(nlCY.missing, ["Q1", "Q3", "Q4"]);
  assert.equal(Selectors.latestQuarter(nvdaLike).net_income, 18.8);// 走季度而非 annual
  assert.equal(Selectors.fiscalYearFromPeriods(nvdaLike, "FY2026").basis, "annual_report");

  // =====================================================================
  // 集成①: calendarYear 用 implied Q4 补全 (自然年公司, 缺 calendar Q4)
  // =====================================================================
  const cyImpliedCo = { id: "cyi", status: "populated", periods: [AN, q1, q2, q3] };
  const cyi = Selectors.calendarYear(cyImpliedCo, 2025);
  assert.equal(cyi.complete, true);                   // Q4 由 annual−(Q1-3) 补 → 完整
  assert.deepEqual(cyi.missing, []);
  assert.equal(cyi.basis, "implied_q4");              // basis 标注 implied
  assert.equal(cyi.coverage.Q4, "implied_q4");
  assert.equal(cyi.coverage.Q1, "actual");
  assert.equal(cyi.revenue, 100);                     // 10+20+30+40 = annual 100
  assert.equal(cyi.net_income, 20);                   // 2+4+6+8
  // 严格 CY: Q1..Q3 start 01-01/04-01/07-01 + implied Q4 [10-01,12-31] → 覆盖 01-01~12-31 → strict
  assert.equal(cyi.strict, true);
  assert.equal(cyi.coverage_start, "2025-01-01");
  assert.equal(cyi.coverage_end, "2025-12-31");

  // 财年错位公司不误用 implied Q4 补 calendar Q4: implied 财季 Q4 不落 calendar Q4 → 仍 incomplete。
  // (Micron 型: annual 财年末非 12-31; 这里用 annual period_end 2025-08-31 → implied Q4 calendar Q3)
  const shiftedAnnual = P({ period_id: "san", kind: "annual", calendar_quarter: null,
    period_start: "2024-09-01", period_end: "2025-08-31", calendar_year: 2025, fiscal_year: "FY2025",
    revenue: 100, net_income: 20, sources: [{ label: "10-K", url: "https://x/k", data_status: "official" }] });
  // 财年错位: fiscal Q1/Q2/Q3 落在 calendar Q4'24 / Q1'25 / Q2'25 (calendar_quarter ≠ fiscal_quarter)
  const sq1 = P({ period_id: "sq1", period_end: "2024-11-30", period_start: "2024-09-01", calendar_year: 2024, calendar_quarter: "Q4", fiscal_year: "FY2025", fiscal_quarter: "Q1", revenue: 10, net_income: 2, sources: [{ label: "q", url: "https://x/1", data_status: "official" }] });
  const sq2 = P({ period_id: "sq2", period_end: "2025-02-28", period_start: "2024-12-01", calendar_year: 2025, calendar_quarter: "Q1", fiscal_year: "FY2025", fiscal_quarter: "Q2", revenue: 20, net_income: 4, sources: [{ label: "q", url: "https://x/2", data_status: "official" }] });
  const sq3 = P({ period_id: "sq3", period_end: "2025-05-31", period_start: "2025-03-01", calendar_year: 2025, calendar_quarter: "Q2", fiscal_year: "FY2025", fiscal_quarter: "Q3", revenue: 30, net_income: 6, sources: [{ label: "q", url: "https://x/3", data_status: "official" }] });
  const shiftCo = { id: "shiftimp", status: "populated", periods: [shiftedAnnual, sq1, sq2, sq3] };
  const iqShift = Selectors.impliedQ4(shiftCo, "FY2025");
  assert.equal(iqShift.calendar_quarter, "Q3");       // period_end 2025-08-31 → 日历 Q3, 非 Q4
  const cyShiftImp = Selectors.calendarYear(shiftCo, 2025);
  // hotfix: implied fiscal-Q4 落 calendar Q3 → 补 Q3 槽 (非硬编码 Q4); 但 CY2025 无 calendar Q4 来源
  // → 仍诚实 incomplete (implied 落在自己该落的 slot, 不冒充缺失的 Q4)。
  assert.equal(cyShiftImp.complete, false);
  assert.deepEqual(cyShiftImp.missing, ["Q4"]);       // 缺的是真正无来源的 Q4, 而非被误报
  assert.equal(cyShiftImp.coverage.Q3, "implied_q4"); // implied 落 calendar Q3 槽

  // ---- 云队列财年错位 (MSFT 6月末 / Oracle 5月末 型): implied 财季 Q4 落 calendar Q2。
  //      hotfix 2026-07-07: calendarYear 现按 implied fiscal-Q4 落入的 calendar slot 补 (非硬编码 Q4),
  //      故财年错位公司的 CY 也能诚实补齐 → complete=true, Q2 槽 basis=implied_q4。TTM 亦用 implied
  //      点亮 (末四季连号含 implied)。锁定四家真实形状里最细的那个边界。 ----
  const cloudQ = (pe, cy, cq, fy, fq, ni) => P({ period_id: `c-${pe}`, period_end: pe,
    calendar_year: cy, calendar_quarter: cq, fiscal_year: fy, fiscal_quarter: fq,
    revenue: 10, net_income: ni, sources: [{ label: "10-Q", url: "https://x/q", data_status: "official" }] });
  const cloudAnnual = P({ period_id: "c-fy2025", kind: "annual", calendar_quarter: null,
    period_start: "2024-07-01", period_end: "2025-06-30", calendar_year: 2025, fiscal_year: "FY2025",
    revenue: 100, net_income: 20, sources: [{ label: "10-K", url: "https://x/k", data_status: "official" }] });
  const cloudShift = { id: "cloudshift", status: "populated", periods: [
    cloudAnnual,
    cloudQ("2024-09-30", 2024, "Q3", "FY2025", "Q1", 3),   // fiscal Q1 FY2025 → 日历 Q3'24
    cloudQ("2024-12-31", 2024, "Q4", "FY2025", "Q2", 4),   // fiscal Q2 FY2025 → 日历 Q4'24
    cloudQ("2025-03-31", 2025, "Q1", "FY2025", "Q3", 5),   // fiscal Q3 FY2025 → 日历 Q1'25
    cloudQ("2025-09-30", 2025, "Q3", "FY2026", "Q1", 6),   // fiscal Q1 FY2026 → 日历 Q3'25
    cloudQ("2025-12-31", 2025, "Q4", "FY2026", "Q2", 7),   // fiscal Q2 FY2026 → 日历 Q4'25
    cloudQ("2026-03-31", 2026, "Q1", "FY2026", "Q3", 9),   // fiscal Q3 FY2026 → 日历 Q1'26
  ]};
  const iqCloud = Selectors.impliedQ4(cloudShift, "FY2025");
  assert.equal(iqCloud.calendar_quarter, "Q2");       // period_end 2025-06-30 → 日历 Q2 (6月末财年)
  assert.equal(iqCloud.net_income, 8);                // 20 − (3+4+5)
  const ttmCloud = Selectors.ttmFromPeriods(cloudShift, "net_income");
  assert.equal(ttmCloud.complete, true);              // 末四季 = implied Q2'25 + Q3'25 + Q4'25 + Q1'26 连号
  assert.equal(ttmCloud.usedImpliedQ4, true);
  assert.equal(ttmCloud.value, 30);                   // 8 + 6 + 7 + 9
  const cyCloud = Selectors.calendarYear(cloudShift, 2025);
  assert.equal(cyCloud.complete, true);               // implied fiscal-Q4 落 calendar Q2 → 补 Q2 槽 → 完整
  assert.deepEqual(cyCloud.missing, []);
  assert.equal(cyCloud.coverage.Q2, "implied_q4");    // Q2 由 implied fiscal-Q4 补, 非硬编码 Q4
  assert.equal(cyCloud.coverage.Q1, "actual");        // 真实 actual 季不被 implied 覆盖 (actual > implied)
  assert.equal(cyCloud.basis, "implied_q4");
  assert.equal(cyCloud.net_income, 26);               // actual Q1 5 + implied Q2 8 + actual Q3 6 + actual Q4 7
  assert.equal(cyCloud.strict, false);                // 合成 actual 季无 period_start → 覆盖不可验证 → proxy (自然年近似)

  // =====================================================================
  // hotfix 2026-07-07 回归: implied fiscal-Q4 按 calendar slot 插 (非硬编码 Q4)
  // =====================================================================
  // (A) 6月末财年 (MSFT型), 四季全带 period_start → implied 落 calendar Q2, CY 补齐且 strict=true。
  const juneFYQ = (pid, pe, ps, cy, cq, fy, fq, ni) => P({ period_id: pid, period_end: pe, period_start: ps,
    calendar_year: cy, calendar_quarter: cq, fiscal_year: fy, fiscal_quarter: fq, revenue: 10, net_income: ni,
    sources: [{ label: "10-Q", url: "https://x/q", data_status: "official" }] });
  const juneCo = { id: "junefy", status: "populated", periods: [
    P({ period_id: "j-fy25", kind: "annual", calendar_quarter: null, period_start: "2024-07-01", period_end: "2025-06-30",
      calendar_year: 2025, fiscal_year: "FY2025", revenue: 100, net_income: 20,
      sources: [{ label: "10-K", url: "https://x/k", data_status: "official" }] }),
    juneFYQ("j-q1", "2024-09-30", "2024-07-01", 2024, "Q3", "FY2025", "Q1", 3),  // fiscal Q1 → 日历 Q3'24
    juneFYQ("j-q2", "2024-12-31", "2024-10-01", 2024, "Q4", "FY2025", "Q2", 4),  // fiscal Q2 → 日历 Q4'24
    juneFYQ("j-q3", "2025-03-31", "2025-01-01", 2025, "Q1", "FY2025", "Q3", 5),  // fiscal Q3 → 日历 Q1'25
    // implied FY2025 Q4: [2025-04-01, 2025-06-30] → 日历 Q2, ni = 20−(3+4+5) = 8
    juneFYQ("j-q5", "2025-09-30", "2025-07-01", 2025, "Q3", "FY2026", "Q1", 6),  // 日历 Q3'25
    juneFYQ("j-q6", "2025-12-31", "2025-10-01", 2025, "Q4", "FY2026", "Q2", 7),  // 日历 Q4'25
  ]};
  const cyJune = Selectors.calendarYear(juneCo, 2025);
  assert.equal(cyJune.complete, true);                // implied 落 calendar Q2 → 补齐
  assert.deepEqual(cyJune.missing, []);
  assert.equal(cyJune.coverage.Q2, "implied_q4");     // Q2 由 implied fiscal-Q4 补 (6月末财年)
  assert.equal(cyJune.strict, true);                  // 四季 [start,end] 恰对齐日历季 → 拼满自然年 → strict
  assert.equal(cyJune.coverage_start, "2025-01-01");
  assert.equal(cyJune.coverage_end, "2025-12-31");
  assert.equal(cyJune.net_income, 26);                // actual Q1 5 + implied Q2 8 + actual Q3 6 + actual Q4 7

  // (B) 月度错位财年 (Oracle型, 2/5/8/11 月末) → complete 但 strict=false (自然年近似)。
  const oraQ = (pid, pe, ps, cy, cq, fy, fq, ni) => P({ period_id: pid, period_end: pe, period_start: ps,
    calendar_year: cy, calendar_quarter: cq, fiscal_year: fy, fiscal_quarter: fq, revenue: 10, net_income: ni,
    sources: [{ label: "10-Q", url: "https://x/q", data_status: "official" }] });
  const oraCo = { id: "orafy", status: "populated", periods: [
    P({ period_id: "o-fy25", kind: "annual", calendar_quarter: null, period_start: "2024-06-01", period_end: "2025-05-31",
      calendar_year: 2025, fiscal_year: "FY2025", revenue: 100, net_income: 20,
      sources: [{ label: "10-K", url: "https://x/k", data_status: "official" }] }),
    oraQ("o-q1", "2024-08-31", "2024-06-01", 2024, "Q3", "FY2025", "Q1", 3),     // 日历 Q3'24
    oraQ("o-q2", "2024-11-30", "2024-09-01", 2024, "Q4", "FY2025", "Q2", 4),     // 日历 Q4'24
    oraQ("o-q3", "2025-02-28", "2024-12-01", 2025, "Q1", "FY2025", "Q3", 5),     // 日历 Q1'25
    // implied FY2025 Q4: [2025-03-01, 2025-05-31] → 日历 Q2, ni = 20−(3+4+5) = 8
    oraQ("o-q5", "2025-08-31", "2025-06-01", 2025, "Q3", "FY2026", "Q1", 6),     // 日历 Q3'25
    oraQ("o-q6", "2025-11-30", "2025-09-01", 2025, "Q4", "FY2026", "Q2", 7),     // 日历 Q4'25
  ]};
  const cyOra = Selectors.calendarYear(oraCo, 2025);
  assert.equal(cyOra.complete, true);                 // 四季齐 (含 implied Q2) → 完整
  assert.deepEqual(cyOra.missing, []);
  assert.equal(cyOra.coverage.Q2, "implied_q4");
  assert.equal(cyOra.strict, false);                  // 端点 (12/1 起, 11/30 止) 偏离自然年首尾 → 近似
  assert.equal(cyOra.coverage_start, "2024-12-01");
  assert.equal(cyOra.coverage_end, "2025-11-30");
  assert.equal(cyOra.net_income, 26);                 // 5 + 8 + 6 + 7

  // (C) 真实 actual 占 calendar 槽 → implied 不覆盖 (actual > implied)。
  //     自然年公司 annual+Q1-3 可派生 implied Q4, 但已有真实 actual Q4 占槽 → 保留 actual。
  const occCo = { id: "occ", status: "populated", periods: [
    P({ period_id: "occ-an", kind: "annual", calendar_quarter: null, period_start: "2025-01-01", period_end: "2025-12-31",
      calendar_year: 2025, fiscal_year: "FY2025", revenue: 100, net_income: 20,
      sources: [{ label: "10-K", url: "https://x/k", data_status: "official" }] }),
    P({ period_id: "occ-q1", period_end: "2025-03-31", period_start: "2025-01-01", calendar_year: 2025, calendar_quarter: "Q1", fiscal_year: "FY2025", fiscal_quarter: "Q1", net_income: 2 }),
    P({ period_id: "occ-q2", period_end: "2025-06-30", period_start: "2025-04-01", calendar_year: 2025, calendar_quarter: "Q2", fiscal_year: "FY2025", fiscal_quarter: "Q2", net_income: 4 }),
    P({ period_id: "occ-q3", period_end: "2025-09-30", period_start: "2025-07-01", calendar_year: 2025, calendar_quarter: "Q3", fiscal_year: "FY2025", fiscal_quarter: "Q3", net_income: 6 }),
    // 真实 actual Q4 (ni=99, 有意异于 implied 20−12=8) 占 calendar Q4 槽
    P({ period_id: "occ-q4", period_end: "2025-12-31", period_start: "2025-10-01", calendar_year: 2025, calendar_quarter: "Q4", fiscal_year: "FY2025", fiscal_quarter: "Q4", net_income: 99 }),
  ]};
  const cyOcc = Selectors.calendarYear(occCo, 2025);
  assert.equal(cyOcc.complete, true);
  assert.equal(cyOcc.coverage.Q4, "actual");          // actual 占槽 → 不被 implied 覆盖
  assert.equal(cyOcc.basis, "periods");               // 无 implied 参与 → basis 仍 periods
  assert.equal(cyOcc.net_income, 111);                // 2+4+6+99 (用真实 Q4=99, 非 implied 8)

  // (D) implied 不跨 targetYear 乱插: implied fiscal-Q4 落 2026, 查 CY2025 不受影响。
  const nextCo = { id: "next", status: "populated", periods: [
    P({ period_id: "n-fy26", kind: "annual", calendar_quarter: null, period_start: "2025-07-01", period_end: "2026-06-30",
      calendar_year: 2026, fiscal_year: "FY2026", revenue: 100, net_income: 20,
      sources: [{ label: "10-K", url: "https://x/k", data_status: "official" }] }),
    juneFYQ("n-q1", "2025-09-30", "2025-07-01", 2025, "Q3", "FY2026", "Q1", 3),  // 日历 Q3'25
    juneFYQ("n-q2", "2025-12-31", "2025-10-01", 2025, "Q4", "FY2026", "Q2", 4),  // 日历 Q4'25
    juneFYQ("n-q3", "2026-03-31", "2026-01-01", 2026, "Q1", "FY2026", "Q3", 5),  // 日历 Q1'26
    // implied FY2026 Q4 → 日历 Q2 2026 (calendar_year 2026), 不应插入 CY2025
  ]};
  const cyNext = Selectors.calendarYear(nextCo, 2025);
  assert.equal(cyNext.complete, false);               // CY2025 仅有 calendar Q3/Q4 → 缺 Q1/Q2
  assert.deepEqual(cyNext.missing, ["Q1", "Q2"]);     // implied (2026) 不越界补进 CY2025
  assert.ok(!Object.values(cyNext.coverage).includes("implied_q4"));

  // =====================================================================
  // 集成②: 严格 CY —— 自然年四季 (显式 period_start) → strict=true
  // =====================================================================
  const strictCo = { id: "strict", status: "populated", periods: [
    P({ period_id: "s1", period_end: "2025-03-31", period_start: "2025-01-01", calendar_year: 2025, calendar_quarter: "Q1", net_income: 2, revenue: 10 }),
    P({ period_id: "s2", period_end: "2025-06-30", period_start: "2025-04-01", calendar_year: 2025, calendar_quarter: "Q2", net_income: 4, revenue: 20 }),
    P({ period_id: "s3", period_end: "2025-09-30", period_start: "2025-07-01", calendar_year: 2025, calendar_quarter: "Q3", net_income: 6, revenue: 30 }),
    P({ period_id: "s4", period_end: "2025-12-31", period_start: "2025-10-01", calendar_year: 2025, calendar_quarter: "Q4", net_income: 8, revenue: 40 }),
  ]};
  const cyStrict = Selectors.calendarYear(strictCo, 2025);
  assert.equal(cyStrict.complete, true);
  assert.equal(cyStrict.strict, true);                // 四季拼接覆盖自然年首尾
  assert.equal(cyStrict.basis, "periods");            // 全 actual, 未用 implied
  assert.equal(cyStrict.coverage_start, "2025-01-01");
  assert.equal(cyStrict.coverage_end, "2025-12-31");
  assert.equal(cyStrict.revenue, 100);

  // period_start 缺一 → 无法验证覆盖 → proxy (strict=false), 但 complete 仍 true
  const proxyCo = { id: "proxy", status: "populated", periods: [
    P({ period_id: "p1", period_end: "2025-03-31", period_start: "2025-01-01", calendar_year: 2025, calendar_quarter: "Q1", net_income: 2 }),
    P({ period_id: "p2", period_end: "2025-06-30", period_start: null, calendar_year: 2025, calendar_quarter: "Q2", net_income: 4 }),
    P({ period_id: "p3", period_end: "2025-09-30", period_start: "2025-07-01", calendar_year: 2025, calendar_quarter: "Q3", net_income: 6 }),
    P({ period_id: "p4", period_end: "2025-12-31", period_start: "2025-10-01", calendar_year: 2025, calendar_quarter: "Q4", net_income: 8 }),
  ]};
  const cyProxy = Selectors.calendarYear(proxyCo, 2025);
  assert.equal(cyProxy.complete, true);
  assert.equal(cyProxy.strict, false);                // 有一季 period_start 缺 → 至多 proxy
  assert.equal(cyProxy.coverage_start, null);         // 起点不全 → coverage_start 留空

  // incomplete 年不给 strict (缺季 → strict 保持 false, coverage_* null)
  const cyIncomplete = Selectors.calendarYear({ id: "inc", periods: [
    P({ period_id: "i1", period_end: "2025-03-31", period_start: "2025-01-01", calendar_year: 2025, calendar_quarter: "Q1", net_income: 2 }),
  ]}, 2025);
  assert.equal(cyIncomplete.complete, false);
  assert.equal(cyIncomplete.strict, false);
  assert.equal(cyIncomplete.coverage_start, null);

  // =====================================================================
  // 集成③: ttmFromPeriods 用 implied Q4 补上美股财年末系统性缺失的第四季
  // =====================================================================
  // 自然年公司: FY2025 annual + FY2025 Q1-Q3 + FY2026 Q1-Q3 (无独立 Q4)。
  // implied FY2025 Q4 (2025-12-31) 插入 Q3'25 与 Q1'26 之间 → 最新四季连号。
  const fy26q = (fq, pe, ni) => P({ period_id: "fy26" + fq, period_end: pe,
    calendar_year: 2026, calendar_quarter: fq, fiscal_year: "FY2026", fiscal_quarter: fq, net_income: ni,
    sources: [{ label: fq, url: "https://x/26" + fq, data_status: "official" }] });
  const ttmImpCo = { id: "ttmimp", status: "populated", periods: [
    AN, q1, q2, q3,                                   // FY2025 annual + Q1-Q3 (ni 2/4/6 → implied Q4 ni 8)
    fy26q("Q1", "2026-03-31", 10), fy26q("Q2", "2026-06-30", 12), fy26q("Q3", "2026-09-30", 14),
  ]};
  const ttmImp = Selectors.ttmFromPeriods(ttmImpCo, "net_income");
  assert.equal(ttmImp.usedImpliedQ4, true);
  assert.equal(ttmImp.contiguous, true);              // implied Q4 当占位季 → 连号成立
  assert.equal(ttmImp.complete, true);
  assert.equal(ttmImp.value, 44);                     // implied Q4(8) + 2026 Q1/Q2/Q3(10+12+14)
  assert.equal(ttmImp.asOf, "2026-09-30");
  assert.deepEqual(ttmImp.basis, ["implied_q4", "actual", "actual", "actual"]);
  // 对照: 抽掉 annual (无 implied) → 最新四季 Q1'25..Q1'26 缺 Q4'25 占位 → 不连续 → null
  const ttmNoAnnual = Selectors.ttmFromPeriods({ id: "na", periods: [q1, q2, q3,
    fy26q("Q1", "2026-03-31", 10), fy26q("Q2", "2026-06-30", 12), fy26q("Q3", "2026-09-30", 14)] }, "net_income");
  assert.equal(ttmNoAnnual.usedImpliedQ4, false);
  assert.equal(ttmNoAnnual.value, null);
  assert.equal(ttmNoAnnual.contiguous, false);
  // actual Q4 优先于 implied Q4: 若已存在真实 Q4'25 季, 不重复插 implied
  const realQ4 = P({ period_id: "realq4", period_end: "2025-12-31", calendar_year: 2025, calendar_quarter: "Q4",
    fiscal_year: "FY2025", fiscal_quarter: "Q4", net_income: 9, sources: [] });
  const ttmRealQ4 = Selectors.ttmFromPeriods({ id: "rq", periods: [AN, q1, q2, q3, realQ4,
    fy26q("Q1", "2026-03-31", 10), fy26q("Q2", "2026-06-30", 12), fy26q("Q3", "2026-09-30", 14)] }, "net_income");
  assert.equal(ttmRealQ4.usedImpliedQ4, false);       // 真实 Q4 占位 → implied 不插
  assert.equal(ttmRealQ4.value, 45);                  // 真实 Q4(9) + 10+12+14

  // =====================================================================
  // ttmNetIncomeUnified(c) — Phase 6 final: periods > null (legacy audit-only)
  // =====================================================================
  // ① periods 完整 (含 implied Q4) → basis="periods", value 来自 ttmFromPeriods, coverage 透传口径
  const uPeriods = Selectors.ttmNetIncomeUnified(ttmImpCo);
  assert.equal(uPeriods.basis, "periods");
  assert.equal(uPeriods.value, 44);                   // 同 ttmFromPeriods
  assert.equal(uPeriods.asOf, "2026-09-30");
  assert.equal(uPeriods.coverage.usedImpliedQ4, true);
  assert.deepEqual(uPeriods.coverage.quarter_basis, ["implied_q4", "actual", "actual", "actual"]);

  // ② periods 不足 / 无真实 periods[] 时,即便 legacy years[]/quarters[] 可审计算出 TTM,
  //    unified 消费入口也必须返回 null,不再 legacy_fallback。
  const legShape = synQ("legc", [FY("FY2025", 40)], [Q("2025-03-31", 6), Q("2026-03-31", 14)]);
  const uLegacy = Selectors.ttmNetIncomeUnified(legShape);
  assert.equal(Selectors.ttmNetIncome(legShape), 48);  // legacy 函数仍可审计对账
  assert.equal(uLegacy.value, null);
  assert.equal(uLegacy.basis, null);
  assert.equal(uLegacy.asOf, null);
  assert.equal(uLegacy.coverage.reason, "no_periods");

  // ③ 两者皆无 → value=null, basis=null (全 null 安全)
  const uNone = Selectors.ttmNetIncomeUnified({ id: "empty", status: "populated" });
  assert.equal(uNone.value, null);
  assert.equal(uNone.basis, null);
  assert.equal(uNone.asOf, null);
  assert.equal(uNone.coverage.reason, "no_periods");
  assert.deepEqual(Selectors.ttmNetIncomeUnified(null), { value: null, basis: null, asOf: null, coverage: { reason: "no_company" } });

  // ④ profitPoolTTM 消费 unified: basisCount 计数 + oracle 型 (periods 有 / legacy 无) 接回;
  //    仅 legacy 的公司不计入。
  const peri = { ...ttmImpCo, id: "nvda", ai_profit_share: 1.0 };          // periods 完整, design 桶
  const leg = { ...legShape, id: "tsmc", ai_profit_share: 1.0 };           // legacy only → skipped
  const oraShape = { ...ttmImpCo, id: "skhynix", ai_profit_share: 1.0 };   // periods 有; 无 years/quarters → legacy 也无, 但 periods 已够 (oracle 型接回)
  const poolMix = Selectors.profitPoolTTM([peri, leg, oraShape]);
  assert.deepEqual(poolMix.basisCount, { periods: 2 });
  assert.equal(poolMix.n, 2);
  const mixCos = Object.fromEntries(poolMix.stages.flatMap(s => s.companies).map(c => [c.id, c]));
  assert.equal(mixCos.nvda.basis, "periods");
  assert.equal(mixCos.tsmc, undefined);
  assert.equal(mixCos.skhynix.basis, "periods");         // periods 有 legacy 无 → periods 接回 (与 oracle 真实数据同型)
  // oracle 型接回: 若无 periods 也无 legacy 的公司 → 不计入 (honest gap, 不 impute)
  const gone = Selectors.profitPoolTTM([{ id: "arm", status: "populated", ai_profit_share: 1.0 }]);
  assert.equal(gone.n, 0);
  assert.deepEqual(gone.basisCount, { periods: 0 });
}

// =====================================================================
// Phase 4 view model: companyMetricView(c, mode, opts)
//   四镜头基本形状 / 无 periods 公司诚实空态 / 缺 AI share / implied Q4 标记透传 /
//   coverage 三分(missing_periods·missing_metric·missing_ai_share) / null 安全。
//   合成数据、数据无关。
// =====================================================================
{
  const P = (o) => ({
    kind: "quarter", status: "actual", period_start: null,
    fiscal_year: null, fiscal_quarter: null, currency: "USD", fx_to_usd: 1,
    revenue: null, gross_profit: null, op_income: null, net_income: null,
    cfo: null, capex: null, segments: [], sources: [], ...o,
  });

  // 自然年公司: FY2025 annual + Q1-Q3 (→ implied Q4) + FY2026 Q1-Q3, 公司级 ai_profit_share=0.5。
  const AN = P({ period_id: "an25", kind: "annual", calendar_quarter: null,
    period_start: "2025-01-01", period_end: "2025-12-31", calendar_year: 2025,
    fiscal_year: "FY2025", revenue: 100, op_income: 30, net_income: 20, cfo: 40, capex: 10,
    sources: [{ label: "10-K", url: "https://x/k", data_status: "official" }] });
  const FQ = (fq, pe, ps, cy, cq, fy, rev, op, ni) => P({ period_id: fy + fq, period_end: pe, period_start: ps,
    calendar_year: cy, calendar_quarter: cq, fiscal_year: fy, fiscal_quarter: fq,
    revenue: rev, op_income: op, net_income: ni, cfo: null, capex: null,
    sources: [{ label: fq, url: "https://x/" + fy + fq, data_status: "official" }] });
  const co = { id: "vm", name: "VM", status: "populated", ai_profit_share: 0.5,
    years: [{ fy: "FY2025", status: "actual", revenue: 100, net_income: 20 }],
    periods: [
      AN,
      FQ("Q1", "2025-03-31", "2025-01-01", 2025, "Q1", "FY2025", 10, 3, 2),
      FQ("Q2", "2025-06-30", "2025-04-01", 2025, "Q2", "FY2025", 20, 6, 4),
      FQ("Q3", "2025-09-30", "2025-07-01", 2025, "Q3", "FY2025", 30, 9, 6),
      FQ("Q1", "2026-03-31", "2026-01-01", 2026, "Q1", "FY2026", 12, 4, 3),
      FQ("Q2", "2026-06-30", "2026-04-01", 2026, "Q2", "FY2026", 15, 5, 4),
      FQ("Q3", "2026-09-30", "2026-07-01", 2026, "Q3", "FY2026", 18, 6, 5),
    ] };

  // ---- latestQuarter: 最新实际季 (2026 Q3) ----
  const lq = Selectors.companyMetricView(co, "latestQuarter");
  assert.equal(lq.mode, "latestQuarter");
  assert.equal(lq.label, "2026Q3");
  assert.equal(lq.complete, true);
  assert.equal(lq.revenue, 18); assert.equal(lq.op_income, 6); assert.equal(lq.net_income, 5);
  assert.equal(lq.coverage.source, "periods");
  assert.equal(lq.coverage.missing_periods, false);
  assert.deepEqual(lq.coverage.missing_metric, []);
  assert.equal(lq.coverage.as_of, "2026-09-30");
  assert.equal(lq.aiShare, 0.5);
  assert.equal(lq.aiWeightedNetIncome, 2.5);          // 5 × 0.5

  // ---- ttm: implied FY2025 Q4(8) + FY2026 Q1/Q2/Q3(3+4+5) 连号 → net_income 20 ----
  const tt = Selectors.companyMetricView(co, "ttm");
  assert.equal(tt.mode, "ttm");
  assert.equal(tt.label, "TTM");
  assert.equal(tt.complete, true);
  assert.equal(tt.net_income, 20);                    // 8 + 3 + 4 + 5
  assert.equal(tt.revenue, 85);                       // impliedQ4 rev 40 + 12 + 15 + 18
  assert.equal(tt.op_income, 27);                     // impliedQ4 op 12 + 4 + 5 + 6
  assert.equal(tt.coverage.used_implied_q4, true);    // implied Q4 标记透传
  assert.deepEqual(tt.coverage.quarter_basis, ["implied_q4", "actual", "actual", "actual"]);
  assert.equal(tt.coverage.as_of, "2026-09-30");
  assert.equal(tt.aiWeightedNetIncome, 10);           // 20 × 0.5
  assert.ok(tt.warnings.some(w => /implied Q4/.test(w)));

  // ---- calendarYear(2025): Q1-Q3 actual + implied Q4 → complete, strict, implied 标记 ----
  const cy = Selectors.companyMetricView(co, "calendarYear", { year: 2025 });
  assert.equal(cy.mode, "calendarYear");
  assert.equal(cy.label, "CY2025");
  assert.equal(cy.complete, true);
  assert.equal(cy.revenue, 100); assert.equal(cy.net_income, 20);
  assert.equal(cy.coverage.used_implied_q4, true);    // Q4 由 implied 补 → 标记透传
  assert.equal(cy.coverage.strict, true);             // 显式 period_start 拼满自然年
  assert.equal(cy.coverage.coverage_start, "2025-01-01");
  assert.equal(cy.coverage.coverage_end, "2025-12-31");
  assert.ok(cy.warnings.some(w => /implied/.test(w)));
  assert.equal(cy.aiWeightedNetIncome, 10);

  // ---- calendarYear(2026): 仅 Q1-Q3, 无 annual FY2026 → 缺 Q4 → 不完整, 灰显带原因 ----
  const cy26 = Selectors.companyMetricView(co, "calendarYear", { year: 2026 });
  assert.equal(cy26.complete, false);
  assert.equal(cy26.net_income, null);
  assert.equal(cy26.coverage.missing_periods, true);
  assert.deepEqual(cy26.coverage.missing_quarters, ["Q4"]);
  assert.equal(cy26.coverage.reason, "missing_quarters");
  assert.equal(cy26.aiWeightedNetIncome, null);       // 净利 null → 加权 null (绝不 0)

  // ---- fiscalYear: 默认取有 annual 的最新 FY (FY2025) → annual_report, complete ----
  const fy = Selectors.companyMetricView(co, "fiscalYear");
  assert.equal(fy.mode, "fiscalYear");
  assert.equal(fy.label, "FY2025");
  assert.equal(fy.complete, true);
  assert.equal(fy.coverage.basis, "annual_report");
  assert.equal(fy.revenue, 100); assert.equal(fy.net_income, 20);
  assert.equal(fy.aiWeightedNetIncome, 10);

  // 显式请求无年度事实的 FY2026 → quarter_sum 仅 3 季 → 不完整
  const fy26 = Selectors.companyMetricView(co, "fiscalYear", { fy: "FY2026" });
  assert.equal(fy26.complete, false);
  assert.equal(fy26.coverage.basis, "quarter_sum");
  assert.equal(fy26.coverage.reason, "insufficient_quarters");
  assert.equal(fy26.net_income, null);

  // =====================================================================
  // 无 periods 公司: 诚实空态 (missing_periods + not_migrated), 不从 years[]/quarters[] 假装
  // =====================================================================
  const legacyCo = { id: "leg", name: "LEG", status: "populated", ai_profit_share: 0.4,
    years: [{ fy: "FY2025", status: "actual", revenue: 100, net_income: 20 }],
    quarters: [
      { period_end: "2025-03-31", label: "Q1", net_income: 5, revenue: 25, sources: [] },
      { period_end: "2026-03-31", label: "Q1", net_income: 6, revenue: 30, sources: [] },
    ] };
  for (const mode of Selectors.VIEW_MODES) {
    const v = Selectors.companyMetricView(legacyCo, mode);
    assert.equal(v.complete, false, mode + " 无 periods → 不完整");
    assert.equal(v.coverage.missing_periods, true, mode + " missing_periods");
    assert.equal(v.coverage.reason, "not_migrated", mode + " reason not_migrated");
    assert.equal(v.coverage.source, "none");
    assert.equal(v.revenue, null); assert.equal(v.net_income, null); // 绝不从 quarters[] 合成假装
    assert.equal(v.aiWeightedNetIncome, null);        // 净利 null → 加权 null
    assert.ok(v.warnings.some(w => /尚未迁入 periods/.test(w)));
  }
  // 无 periods 但公司级 aiShare 仍透出 (period-independent), 只是没有净利可加权
  assert.equal(Selectors.companyMetricView(legacyCo, "ttm").aiShare, 0.4);
  assert.equal(Selectors.companyMetricView(legacyCo, "ttm").coverage.missing_ai_share, false);

  // =====================================================================
  // 缺 AI share: aiShare=null → missing_ai_share, aiWeightedNetIncome=null (即便有净利)
  // =====================================================================
  const noAiCo = { id: "noai", name: "NOAI", status: "populated",
    years: [{ fy: "FY2025", status: "actual", revenue: 100, net_income: 20, segments: [] }], // 无 is_ai → aiShare null
    periods: [
      FQ("Q1", "2025-03-31", "2025-01-01", 2025, "Q1", "FY2025", 10, 3, 2),
      FQ("Q2", "2025-06-30", "2025-04-01", 2025, "Q2", "FY2025", 20, 6, 4),
      FQ("Q3", "2025-09-30", "2025-07-01", 2025, "Q3", "FY2025", 30, 9, 6),
      FQ("Q4", "2025-12-31", "2025-10-01", 2025, "Q4", "FY2025", 40, 12, 8),
    ] };
  const noAi = Selectors.companyMetricView(noAiCo, "calendarYear", { year: 2025 });
  assert.equal(noAi.complete, true);                  // 四季齐 → 结构完整
  assert.equal(noAi.net_income, 20);                  // 净利有值
  assert.equal(noAi.aiShare, null);                   // 但缺 AI 占比
  assert.equal(noAi.coverage.missing_ai_share, true);
  assert.equal(noAi.aiWeightedNetIncome, null);       // 缺 share → 加权 null, 绝不 0
  assert.ok(noAi.warnings.some(w => /缺 AI 占比/.test(w)));

  // 结构完整但某指标缺 → missing_metric (op_income 缺一季)
  const gapCo = { id: "gapc", name: "GAP", status: "populated", ai_profit_share: 0.5,
    years: [{ fy: "FY2025", status: "actual", revenue: 100, net_income: 20 }],
    periods: [
      FQ("Q1", "2025-03-31", "2025-01-01", 2025, "Q1", "FY2025", 10, 3, 2),
      FQ("Q2", "2025-06-30", "2025-04-01", 2025, "Q2", "FY2025", 20, null, 4), // op 缺
      FQ("Q3", "2025-09-30", "2025-07-01", 2025, "Q3", "FY2025", 30, 9, 6),
      FQ("Q4", "2025-12-31", "2025-10-01", 2025, "Q4", "FY2025", 40, 12, 8),
    ] };
  const gv = Selectors.companyMetricView(gapCo, "calendarYear", { year: 2025 });
  assert.equal(gv.complete, true);                    // 季度覆盖完整 → complete (net 有值)
  assert.equal(gv.revenue, 100); assert.equal(gv.net_income, 20);
  assert.equal(gv.op_income, null);                   // 一季 op 缺 → 该指标 null
  assert.deepEqual(gv.coverage.missing_metric, ["op_income"]);

  // =====================================================================
  // null 安全 / 未知镜头
  // =====================================================================
  const vnull = Selectors.companyMetricView(null, "ttm");
  assert.equal(vnull.complete, false);
  assert.equal(vnull.coverage.missing_periods, true);
  assert.equal(vnull.revenue, null); assert.equal(vnull.aiShare, null);
  const vbad = Selectors.companyMetricView(co, "nope");
  assert.equal(vbad.complete, false);
  assert.equal(vbad.coverage.reason, "unknown_mode");
}

console.log("logic tests passed");
