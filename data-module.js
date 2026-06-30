/* =====================================================================
   data-module.js — the data-access layer. NO DOM, NO formatting.
   Responsibilities: load the canonical JSON, and DERIVE everything the
   view needs (margins, YoY, reconciliation, segment ordering). Raw facts
   are never recomputed; derived values are never stored.
   Consumed by the view via the globals `Store` and `Selectors`.
   ===================================================================== */
const Store = {
  _data: null,

  /* Serving format is JSON. Same schema whether embedded or external:
     (A) embedded <script id="dataset"> for single-file / offline use;
     (B) external companies.json when served over HTTP — the swap is one line. */
  async load() {
    if (this._data) return this._data;
    const el = (typeof document !== "undefined") && document.getElementById("dataset");
    if (el && el.textContent.trim()) {
      this._data = JSON.parse(el.textContent);
    } else {
      const res = await fetch("companies.json");   // <-- the only line that changes when serving over HTTP
      this._data = await res.json();
    }
    return this._data;
  },

  meta()        { return this._data.meta; },
  companies()   { return this._data.companies; },
  byId(id)      { return this._data.companies.find(c => c.id === id); },
  populated()   { return this._data.companies.filter(c => c.status === "populated" && c.years.length); },
  pending()     { return this._data.companies.filter(c => c.status !== "populated" || !c.years.length); },
};

const Selectors = {
  /* ---- year-level derivations ---- */
  netMargin(y) { return (y && y.revenue && y.net_income != null) ? y.net_income / y.revenue : null; },
  opMargin(y)  { return (y && y.revenue && y.op_income  != null) ? y.op_income  / y.revenue : null; },

  /* ---- cash & capital intensity (the "who burns cash on fabs vs who mints it" lens) ----
     capex is stored as a sign-neutral magnitude; FCF = operating cash flow − capex.
     All null-safe: a missing input yields null (honest gap), never a fabricated 0. */
  capexIntensity(y) { return (y && y.revenue && y.capex != null) ? y.capex / y.revenue : null; },
  fcf(y)            { return (y && y.cfo != null && y.capex != null) ? y.cfo - y.capex : null; },
  fcfMargin(y)      { const f = this.fcf(y); return (f != null && y.revenue) ? f / y.revenue : null; },
  cashConversion(y) { const f = this.fcf(y); return (f != null && y.net_income) ? f / y.net_income : null; },

  /* ---- company-level helpers ---- */
  actualYears(c)   { return c.years.filter(y => y.status === "actual"); },
  forecastYear(c)  { return c.years.find(y => y.status === "forecast"); },
  latestActual(c)  { const a = this.actualYears(c); return a.length ? a[a.length - 1] : null; },
  yearIndex(c, fy) { return c.years.findIndex(y => y.fy === fy); },
  yearByFy(c, fy)  { return c.years.find(y => y.fy === fy); },

  revYoY(c, fy) {
    const i = this.yearIndex(c, fy);
    if (i <= 0) return null;
    const a = c.years[i - 1].revenue, b = c.years[i].revenue;
    return a ? (b - a) / a : null;
  },

  /* ---- segments ---- */
  revenueSegs(y)   { return (y.segments || []).filter(s => s.revenue != null); },
  revenueSorted(y) { return this.revenueSegs(y).slice().sort((a, b) => b.revenue - a.revenue); },
  revenueTotal(y)  { return this.revenueSegs(y).reduce((s, p) => s + p.revenue, 0); },

  /* "platform" segments cleanly partition revenue (NVIDIA → sum == revenue);
     "division" segments include inter-segment sales (Samsung → sum > revenue). */
  segmentKind(y) { return this.revenueSegs(y).some(s => s.kind === "division") ? "division" : "platform"; },

  reconcile(y) {
    const sum = this.revenueTotal(y), rev = y.revenue, kind = this.segmentKind(y);
    const partition = kind === "platform";
    return { sum, revenue: rev, diff: sum - rev, kind, partition, ok: partition && Math.abs(sum - rev) < 0.05 };
  },

  segYoY(c, fy, name) {
    const i = this.yearIndex(c, fy);
    if (i <= 0) return null;
    const prev = (c.years[i - 1].segments || []).find(s => s.name === name);
    const cur  = (this.yearByFy(c, fy).segments || []).find(s => s.name === name);
    return (prev && cur && prev.revenue) ? (cur.revenue - prev.revenue) / prev.revenue : null;
  },

  /* Does this year disclose profit at the segment level?
     Drives whether the drill-down shows a real profit table or an honest gap. */
  hasSegmentProfit(y) { return this.revenueSegs(y).some(s => s.op_income != null); },
  profitSorted(y)     { return this.revenueSegs(y).filter(s => s.op_income != null)
                                    .sort((a, b) => b.op_income - a.op_income); },

  /* ---- valuation (single-slice market snapshot vs latest actual year) ----
     quote.market_cap is the ONLY cross-currency-safe value (already USD bn, same 口径
     as revenue/net_income) — use it directly, never multiply by FX.
     valuation_caveat三态: 'na' → 整项留空(null); 'distorted' → 照常返回数值(供视图警示);
     'ok'/缺省 → 正常。所有倍数 null-safe，分母统一用 latestActual。 */
  marketCap(c)      { return c.quote?.market_cap ?? null; },
  valuationCaveat(c, key) { return c.valuation_caveat?.[key] ?? "ok"; },

  pe(c) {
    if (this.valuationCaveat(c, "pe") === "na") return null;
    const mc = this.marketCap(c), y = this.latestActual(c);
    return (mc != null && y && y.net_income) ? mc / y.net_income : null;
  },
  ps(c) {
    if (this.valuationCaveat(c, "ps") === "na") return null;
    const mc = this.marketCap(c), y = this.latestActual(c);
    return (mc != null && y && y.revenue) ? mc / y.revenue : null;
  },
  fcfYield(c) {
    if (this.valuationCaveat(c, "fcf_yield") === "na") return null;
    // FCF from the latest year that actually carries cash inputs (capex/cfo lag the headline year),
    // mirroring how the company-page cash block and fcfMargin/capexInt home metrics pick their year.
    const mc = this.marketCap(c), f = this.fcf(this.latestCashYear(c));
    return (mc != null && f != null && mc) ? f / mc : null;
  },

  /* ---- directory metric accessors (cross-company) ---- */
  /* latest actual year that carries cash inputs (capex/cfo may lag the headline year) */
  latestCashYear(c) { return this.actualYears(c).reverse().find(y => y.capex != null || y.cfo != null) || null; },

  homeMetric(c, key) {
    if (key === "fcfMargin" || key === "capexInt") {
      const cy = this.latestCashYear(c);
      if (!cy) return null;
      return key === "fcfMargin" ? this.fcfMargin(cy) : this.capexIntensity(cy);
    }
    if (key === "pe")       return this.pe(c);
    if (key === "ps")       return this.ps(c);
    if (key === "fcfYield") return this.fcfYield(c);
    const y = this.latestActual(c);
    if (!y) return null;
    if (key === "revenue")   return y.revenue;
    if (key === "netIncome") return y.net_income;
    if (key === "netM")      return this.netMargin(y);
    return null;
  },
};

/* Allow reuse in Node (validator/tests) as well as the browser */
if (typeof module !== "undefined" && module.exports) module.exports = { Store, Selectors };
