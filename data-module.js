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

  /* ---- directory metric accessors (cross-company) ---- */
  homeMetric(c, key) {
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
