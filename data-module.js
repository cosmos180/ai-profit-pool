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
    _refreshStages(this._data && this._data.meta);   // derive STAGE_ORDER/LABEL/COLOR from meta.stages (ADR-1)
    return this._data;
  },

  meta()        { return this._data.meta; },
  companies()   { return this._data.companies; },
  byId(id)      { return this._data.companies.find(c => c.id === id); },
  populated()   { return this._data.companies.filter(c => c.status === "populated" && c.years.length); },
  pending()     { return this._data.companies.filter(c => c.status !== "populated" || !c.years.length); },
};

/* =====================================================================
   Value-chain stages for the "profit-pool migration" view (ADR-1: 环节数据化).
   The canonical, ordered source of truth now lives in DATA: meta.stages[]
   ({key,label,color,order}). This module DERIVES STAGE_ORDER / STAGE_LABEL /
   STAGE_COLOR from it (sorted by `order`), so adding a stage is a pure-data
   change. Company归位 prefers c.chain_stage, falling back to STAGE_OF_FALLBACK
   (the former hard-coded id→stage map) so meta.stages-absent or chain_stage-
   absent data behaves exactly as before.
   The exported STAGE_ORDER / STAGE_LABEL keep their identity (mutated in place
   by _refreshStages) so tests / templates that imported them still see the
   derived values after Store loads.
   ===================================================================== */
const STAGE_OF_FALLBACK = {
  nvda: "design", broadcom: "design",
  tsmc: "foundry",
  samsung: "memory", skhynix: "memory", micron: "memory",
  asml: "equipment",
  softbank: "invest",
  tencent: "app",
};
// Built-in defaults — used verbatim when meta.stages is absent (backward-compat).
const STAGE_ORDER = ["design", "foundry", "memory", "equipment", "invest", "app"];
const STAGE_LABEL = {
  design: "设计", foundry: "代工", memory: "存储", equipment: "设备", invest: "投资", app: "应用",
};
const STAGE_COLOR = {};

/* Recompute STAGE_ORDER / STAGE_LABEL / STAGE_COLOR from meta.stages, IN PLACE
   (preserving the exported references). No-op when meta.stages is absent/empty,
   leaving the built-in constants intact. Called from Store.load() and is safe to
   call repeatedly / directly in Node tests after setting Store._data. */
function _refreshStages(meta) {
  const stages = meta && Array.isArray(meta.stages) ? meta.stages : null;
  if (!stages || !stages.length) return;
  const sorted = stages.slice().sort((a, b) => a.order - b.order);
  STAGE_ORDER.length = 0;
  for (const k of Object.keys(STAGE_LABEL)) delete STAGE_LABEL[k];
  for (const k of Object.keys(STAGE_COLOR)) delete STAGE_COLOR[k];
  for (const s of sorted) {
    STAGE_ORDER.push(s.key);
    STAGE_LABEL[s.key] = s.label;
    STAGE_COLOR[s.key] = s.color;
  }
}

/* Which value-chain stage a company occupies: data-driven chain_stage first,
   else the built-in fallback map (null if neither knows it). */
function stageOf(c) {
  return (c && c.chain_stage) || (c && STAGE_OF_FALLBACK[c.id]) || null;
}

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

  /* 分部营收占「分部合计」比（division 口径：分母 = revenueTotal(y) = 分部 revenue 之和，
     对 division-kind 含内部交易时仍自洽）。缺 revenue/零分母 → null（不伪造 0）。算不存。
     注意：这与 incomeFlow 的 segment.share 分母不同——那处分母是 y.revenue（合并营收），
     此处分母是分部合计，两口径不可混用（见 aiShare 注释同款约束）。*/
  segRevShare(y, name) {
    const seg = this.revenueSegs(y).find(s => s.name === name);
    if (!seg || seg.revenue == null) return null;
    const total = this.revenueTotal(y);
    return total ? seg.revenue / total : null;
  },

  /* 分部经营利润率：seg.op_margin 优先（若已录入），否则 op_income/revenue 回退。
     任一分母/分子缺失或零分母 → null（界面留空，不伪造）。算不存。*/
  segOpMargin(seg) {
    if (!seg) return null;
    if (seg.op_margin != null) return seg.op_margin;
    return (seg.op_income != null && seg.revenue) ? seg.op_income / seg.revenue : null;
  },

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

  /* ---- AI attribution share (ADR-3, C-weighted pool; fallback = B) ----
     aiShare(c, y) → {value, basis} : the fraction of net income to attribute to AI.
     Priority ladder (value never invented):
       1. company-level ai_profit_share (sourced ESTIMATE) → basis 'sourced',
          applies to ANY year (a top-down profit attribution, year-agnostic).
       2. else the year's segment is_ai REVENUE proxy → basis 'proxy':
            value = Σ(is_ai segment revenue) / 分部营收口径.
          关键: division-kind segments (e.g. Samsung) include inter-segment sales and
          sum > consolidated revenue, so the denominator MUST be revenueTotal(y) (the
          segment sum), NOT y.revenue. platform-kind cleanly partitions so either works
          — we use revenueTotal(y) uniformly (equals y.revenue for platforms).
       3. else (fallback B) → value null. We do NOT seed a default from ai_exposure
          (pure/primary never auto-get 1.0/0.85); honest gap, the company is dropped
          from the C-weighted pool rather than imputed.
     y defaults to latestActual(c). Null-safe throughout. */
  aiShare(c, y) {
    if (!c) return { value: null, basis: "none" };
    if (c.ai_profit_share != null) return { value: c.ai_profit_share, basis: "sourced" };
    const yr = y || this.latestActual(c);
    if (!yr) return { value: null, basis: "none" };
    const segs = this.revenueSegs(yr);
    // need at least one segment carrying an explicit is_ai flag to derive a proxy
    if (!segs.length || !segs.some(s => Object.prototype.hasOwnProperty.call(s, "is_ai"))) {
      return { value: null, basis: "none" };
    }
    const denom = this.revenueTotal(yr);   // segment-sum 口径 (division-safe)
    if (!denom) return { value: null, basis: "none" };
    const aiRev = segs.filter(s => s.is_ai).reduce((s, p) => s + p.revenue, 0);
    return { value: aiRev / denom, basis: "proxy" };
  },

  /* ---- income-statement flow (for the FY drill-down Sankey) ----
     Left→right money flow of the P&L, in USD bn, derived ENTIRELY from existing
     fields (算不存). Strictly null-safe: a missing input leaves that link null and
     flips its has.* flag false so the view degrades honestly (renders a simplified
     flow) instead of fabricating a 0 or estimating a margin.
       segments[] = revenueSorted(y) (left tributaries into revenue; [] if undisclosed)
       cogs/grossProfit  from gross_margin (both null if gross_margin missing)
       opex              = grossProfit − opProfit (null unless BOTH known)
       opProfit          = y.op_income
       taxOther          = opProfit − netIncome, SIGNED — negative means net > op
                           (non-operating gains, e.g. NVDA interest/investment income);
                           never abs()'d, so the view can show an inflow vs outflow.
     revenue null (rare) ⇒ whole flow unavailable. */
  incomeFlow(y) {
    if (!y || y.revenue == null) {
      return {
        segments: [], revenue: null,
        grossProfit: null, cogs: null,
        opProfit: null, opex: null,
        netIncome: null, taxOther: null,
        has: { gross: false, opex: false, taxOther: false, segments: false },
      };
    }
    const revenue = y.revenue;
    // segment.share 分母 = revenue（合并营收 y.revenue），供桑基分部支流标占比。
    // 注意口径：此处分母是 y.revenue，与 segRevShare(y,name) 的分母（分部合计）不同，勿混用。
    const segments = this.revenueSorted(y).map(s => ({
      name: s.name, revenue: s.revenue, is_ai: !!s.is_ai,
      share: (s.revenue != null && revenue) ? s.revenue / revenue : null,
    }));

    const gm = y.gross_margin;
    const grossProfit = (gm != null) ? revenue * gm : null;
    const cogs        = (grossProfit != null) ? revenue - grossProfit : null;

    const opProfit = (y.op_income != null) ? y.op_income : null;
    const opex     = (grossProfit != null && opProfit != null) ? grossProfit - opProfit : null;

    const netIncome = (y.net_income != null) ? y.net_income : null;
    const taxOther  = (opProfit != null && netIncome != null) ? opProfit - netIncome : null;

    return {
      segments, revenue,
      grossProfit, cogs,
      opProfit, opex,
      netIncome, taxOther,
      has: {
        gross:    grossProfit != null,
        opex:     opex != null,
        taxOther: taxOther != null,
        segments: segments.length > 0,
      },
    };
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
  netDebt(c)        { return c.quote?.net_debt ?? null; },
  valuationCaveat(c, key) { return c.valuation_caveat?.[key] ?? "ok"; },

  /* EV = market_cap + net_debt. net_debt 缺失/null → null（区分"缺失"与"0"，
     不可假设 EV=市值：净负债=0 与"未知"是两回事）。net_debt 负数=净现金 → EV<市值。 */
  ev(c) {
    const mc = this.marketCap(c), nd = this.netDebt(c);
    return (mc != null && nd != null) ? mc + nd : null;
  },
  /* EV/Sales：caveat 'na' → null；否则 ev 与最新实际年 revenue 都有 → ev/revenue。
     'distorted'（如软银投资控股）仍出值，供视图警示。分母统一用 latestActual。 */
  evSales(c) {
    if (this.valuationCaveat(c, "ev_sales") === "na") return null;
    const e = this.ev(c), y = this.latestActual(c);
    return (e != null && y && y.revenue) ? e / y.revenue : null;
  },
  /* 净利润同比（PEG 近似的 G）：公司级最新实际年 vs 上一实际年 net_income。
     仅当上一年 net_income > 0 才算（上一年 ≤0 = 周期反转，基期无意义 → null，
     视图据此标"不可比"）；<2 个实际年或缺 net_income → null。算不存。 */
  niYoY(c) {
    const a = this.actualYears(c);
    if (a.length < 2) return null;
    const prev = a[a.length - 2].net_income, cur = a[a.length - 1].net_income;
    if (prev == null || cur == null) return null;
    if (prev <= 0) return null;   // 上一年 ≤0：基期无意义，不可比
    return (cur - prev) / prev;
  },

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

  /* 前瞻 PE (NTM · consensus)：price ÷ consensus_eps_value，两者同币才算（不跨币相乘）。
     price 取 quote.price（本币原值），consensus_eps_value 取 forecast 年的数值型一致预期 EPS，
     币种须 = quote.price_currency。与 trailing pe() 复用同一 caveat：pe='na' → 前瞻 PE 也 na(null)。
     全 null-safe：缺 price / 缺 forecast 年 / 缺 consensus_eps_value / 币种不一致 → null。算不存。 */
  forwardPE(c) {
    if (this.valuationCaveat(c, "pe") === "na") return null;
    const price = c.quote?.price;
    const priceCur = c.quote?.price_currency;
    const fy = this.forecastYear(c);
    if (price == null || fy == null) return null;
    const eps = fy.consensus_eps_value;
    if (eps == null || eps === 0) return null;
    // 同币才算（前瞻 PE = price/eps 需口径一致，跨币不相乘 → null）
    const epsCur = fy.consensus_eps_currency;
    if (priceCur && epsCur && priceCur !== epsCur) return null;
    return price / eps;
  },

  /* ---- B1: same-stage relative valuation (comps) ----
     同价值链环节的相对估值 —— 纯派生, 零新增数据。回答"这个倍数在同环节里是贵是便宜",
     把跨环节混排的孤立绝对数字带上同环节语境。

     stageValuationRel(c, key), key ∈ {pe, ps, evSales, fcfYield}:
       cohort = 所有 populated 公司里 stageOf 相同者;对每家取该 key 的值(复用现有倍数 Selector)。
       排除三类成员(它们本就不参与横比):
         · 该指标 valuationCaveat 为 'na' 或 'distorted'(如软银 pe/fcf_yield=na、
           softbank ps/ev_sales=distorted、tencent pe=distorted);
         · 值为 null 的(缺分母/缺现金/无实际年 → 诚实缺席)。
       cohortN = 有效成员数。median = cohort 有效值的中位数。

     relative 口径(刻意不掺"便宜/贵"): 'low'|'mid'|'high' 指**数值相对中位数**的高低,
       ±15% 带 —— value < median×0.85 → 'low';value > median×1.15 → 'high';否则 'mid'。
       方向语义交给视图:lowerCheaper 标出"低=便宜"(pe/ps/evSales)还是"高=便宜"(fcfYield),
       视图据 relative + lowerCheaper 生成"更便宜/更贵/居中"文案。这样数值口径单一、不会歧义。

     诚实边界:
       · insufficient:true 当有效 cohortN < 3(样本不足 → 不给 relative/median,视图显"样本不足");
       · 本公司自身该指标为 na/distorted 或值为 null → 它没有相对位置,返回 insufficient(value=null)。
     全 null 安全,绝不伪造。算不存。
     返回 { key, value, cohortN, median, relative, lowerCheaper, insufficient }。 */
  VAL_KEY_META: {
    pe:       { caveat: "pe",        lowerCheaper: true  },
    ps:       { caveat: "ps",        lowerCheaper: true  },
    evSales:  { caveat: "ev_sales",  lowerCheaper: true  },
    fcfYield: { caveat: "fcf_yield", lowerCheaper: false },
  },
  VAL_REL_BAND: 0.15,   // ±15% 带宽:偏离中位数超此比例才判 low/high,否则 mid(居中)

  _valMetric(c, key) {
    // 该 key 对应的倍数值,已内含各自 caveat='na'→null 的处理(见 pe/ps/evSales/fcfYield)
    if (key === "pe")       return this.pe(c);
    if (key === "ps")       return this.ps(c);
    if (key === "evSales")  return this.evSales(c);
    if (key === "fcfYield") return this.fcfYield(c);
    return null;
  },
  /* 一家公司在某指标上是否可参与同环节横比:caveat 非 na/distorted 且值非 null。 */
  _valComparable(c, key) {
    const meta = this.VAL_KEY_META[key];
    if (!meta) return false;
    const cav = this.valuationCaveat(c, meta.caveat);
    if (cav === "na" || cav === "distorted") return false;
    return this._valMetric(c, key) != null;
  },
  _median(nums) {
    if (!nums.length) return null;
    const s = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  },

  stageValuationRel(c, key) {
    const meta = this.VAL_KEY_META[key];
    const blank = { key, value: null, cohortN: 0, median: null, relative: null,
                    lowerCheaper: meta ? meta.lowerCheaper : null, insufficient: true };
    if (!c || !meta) return blank;

    const stage = stageOf(c);
    if (!stage) return blank;

    // cohort = 同环节且该指标可比的 populated 公司(含本公司,若本公司可比)
    const pop = (Store._data && Store.populated()) || [];
    const cohort = pop.filter(o => stageOf(o) === stage && this._valComparable(o, key));
    const values = cohort.map(o => this._valMetric(o, key));
    const cohortN = values.length;
    const median = this._median(values);

    // 本公司自身不可比(na/distorted/null)→ 没有相对位置
    const self = this._valComparable(c, key) ? this._valMetric(c, key) : null;
    if (self == null) {
      return { key, value: null, cohortN, median, relative: null,
               lowerCheaper: meta.lowerCheaper, insufficient: true };
    }
    // 有效样本过小 → 诚实"样本不足",不给相对位置
    if (cohortN < 3 || median == null || median === 0) {
      return { key, value: self, cohortN, median, relative: null,
               lowerCheaper: meta.lowerCheaper, insufficient: true };
    }

    const band = this.VAL_REL_BAND;
    let relative = "mid";
    if (self < median * (1 - band)) relative = "low";
    else if (self > median * (1 + band)) relative = "high";

    return { key, value: self, cohortN, median, relative,
             lowerCheaper: meta.lowerCheaper, insufficient: false };
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
    if (key === "evSales")  return this.evSales(c);
    if (key === "fcfYield") return this.fcfYield(c);
    const y = this.latestActual(c);
    if (!y) return null;
    if (key === "revenue")   return y.revenue;
    if (key === "netIncome") return y.net_income;
    if (key === "netM")      return this.netMargin(y);
    return null;
  },

  /* ---- shared value-chain aggregation atom ----
     Given rows [{id, name, ni}] (ni = a net-income measure, FY or TTM) and a total,
     fold them into the canonical STAGE_ORDER buckets. Reused by both the annual
     profit-pool migration and the TTM profit pool so the two口径 never drift.
     ni may be negative (memory downcycle); share = value/total when total>0 (the
     view renders negatives), else null. companies[] preserves per-member traceability. */
  _aggregateStages(rows, total) {
    return STAGE_ORDER.map(stage => {
      const members = rows.filter(r => (r.stage || STAGE_OF_FALLBACK[r.id]) === stage);
      const value = members.reduce((s, r) => s + r.ni, 0);
      return {
        stage,
        label: STAGE_LABEL[stage],
        value,
        share: total ? value / total : null,
        companies: members.map(r => ({ id: r.id, name: r.name, ni: r.ni, asOf: r.asOf })),
      };
    });
  },

  /* ---- TTM (trailing-twelve-month) net income, self-rolled ----
     口径 (architect): TTM = latest complete FY net_income
                            + Σ quarters reported AFTER that FY-end
                            − Σ the year-ago matching quarters (~365d earlier).
     Works purely off quarters[].period_end (machine ISO date) — NEVER parses
     `label`, NEVER touches years[].period_end (free text). Generalises to N
     trailing quarters (e.g. Micron with 3 post-FY quarters).
     Returns null (honest gap) if ANY required atom is missing:
       no latest complete FY net_income / a post-FY quarter's net_income is null /
       no ~365d-ago match for some add-on quarter / that match's net_income is null. */
  DAY_MS: 86400000,
  YEAR_TOL_DAYS: 45,

  _parseDate(s) {
    if (typeof s !== "string") return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  },
  /* quarters carrying a parseable period_end, ascending by date */
  _datedQuarters(c) {
    return (c.quarters || [])
      .map(q => ({ q, t: this._parseDate(q.period_end) }))
      .filter(x => x.t != null)
      .sort((a, b) => a.t - b.t);
  },

  ttmNetIncome(c) {
    if (!c) return null;
    // anchor on the latest COMPLETE fiscal year with a non-null net_income
    const fy = this.latestActual(c);
    if (!fy || fy.net_income == null) return null;

    const dq = this._datedQuarters(c);
    if (!dq.length) return null;                       // no quarters → cannot self-roll → null (honest)

    // Add-on quarters = the post-FY-end quarters, identified PURELY by date pairing
    // (never by parsing label or the free-text years[].period_end):
    // a quarter is an add-on iff it has a ~365-day-EARLIER counterpart also in the set
    // (that earlier counterpart is the in-FY year-ago quarter we subtract). The
    // year-ago quarters themselves are NOT add-ons (their own ~365d-ago twin isn't
    // recorded). This generalises to N trailing quarters (Micron → 3 add-ons + 3 twins).
    const addOns = dq.filter(x => {
      const prior = this._matchYearAgo(dq, x.t);
      return prior && prior.t < x.t;
    });
    if (!addOns.length) return null;                   // no complete add-on pair → cannot roll → null

    let ttm = fy.net_income;
    for (const a of addOns) {
      if (a.q.net_income == null) return null;          // add-on quarter NI missing → null
      const prior = this._matchYearAgo(dq, a.t);
      if (!prior || prior.q.net_income == null) return null; // no/empty year-ago match → null
      ttm += a.q.net_income - prior.q.net_income;
    }
    return ttm;
  },

  /* find the quarter ~365 days before time t, within ±YEAR_TOL_DAYS (closest wins) */
  _matchYearAgo(dq, t) {
    const target = t - 365 * this.DAY_MS;
    const tol = this.YEAR_TOL_DAYS * this.DAY_MS;
    let best = null, bestD = Infinity;
    for (const x of dq) {
      const d = Math.abs(x.t - target);
      if (d <= tol && d < bestD) { bestD = d; best = x; }
    }
    return best;
  },

  /* as-of date (ISO string) of a company's latest reported quarter, or null */
  ttmAsOf(c) {
    const dq = this._datedQuarters(c);
    return dq.length ? dq[dq.length - 1].q.period_end : null;
  },

  /* ---- TTM profit pool (value-chain stacked, self-rolled per company, AI-weighted) ----
     口径统一 (ADR-3): TTM 净利同样按 aiShare(c) 加权,与 profitPoolAI / profitPoolMigration
     的三根年度柱完全同口径 —— 同一张迁移图不再混"全额 TTM vs 加权年度"。
       ni = ttmNetIncome(c) × aiShare(c).value (公司级,用 latestActual 的 is_ai 代理)。
     Per-company null-safe & honest-gap: ttmNetIncome 为 null 或 aiShare.value 为 null 的
     公司一律 DROP(绝不计 0、不 impute),与年度口径一致。total 仅累计加权后的贡献者。
     Reuses the same _aggregateStages atom as the annual migration so stage口径 cannot drift.
     asOfSpreadDays = max−min of contributing companies' latest-quarter dates — lets
     the view warn that the TTM cross-section is not perfectly date-aligned. */
  profitPoolTTM(companies) {
    const list = companies || [];
    const rows = [];
    let spreadMin = Infinity, spreadMax = -Infinity;
    for (const c of list) {
      const ttm = this.ttmNetIncome(c);
      if (ttm == null) continue;                        // honest gap: skip, never impute
      const share = this.aiShare(c).value;              // company-level, latestActual is_ai proxy
      if (share == null) continue;                      // no aiShare → drop (ADR-3, same as annual)
      const asOf = this.ttmAsOf(c);
      const t = this._parseDate(asOf);
      if (t != null) { if (t < spreadMin) spreadMin = t; if (t > spreadMax) spreadMax = t; }
      rows.push({ id: c.id, name: c.name, stage: stageOf(c), ni: ttm * share, asOf, aiShare: share });
    }
    const total = rows.reduce((s, r) => s + r.ni, 0);
    const stages = this._aggregateStages(rows, total).map(s => ({
      ...s,
      companies: s.companies.map(m => {
        const src = rows.find(r => r.id === m.id);
        return { id: m.id, name: m.name, ttm: m.ni, asOf: m.asOf, aiShare: src ? src.aiShare : null };
      }),
    }));
    const asOfSpreadDays = rows.length
      ? Math.round((spreadMax - spreadMin) / this.DAY_MS)
      : null;
    return {
      label: "TTM(AI 加权,截至各家最近季报)",
      total,
      n: rows.length,
      asOfSpreadDays,
      stages,
    };
  },

  /* ---- AI profit pool (C-weighted, value-chain stacked) (ADR-3, core) ----
     pool = Σ over companies of latestActual.net_income × aiShare(c).value.
     A company whose aiShare.value is null is DROPPED (fallback B: never counted as
     0, never imputed) — same honest-gap discipline as profitPoolTTM. Net income
     itself is weighted, so each row's `ni` is the AI-attributed net income; the
     shared _aggregateStages atom folds them into the canonical stages.
       N = populated/eligible company count (rows considered)
       n = companies with a valid aiShare that actually contributed
       basisCount = {sourced, proxy} tally over contributors (transparency) */
  profitPoolAI(companies) {
    const list = companies || [];
    const rows = [];
    const basisCount = { sourced: 0, proxy: 0 };
    let N = 0;
    for (const c of list) {
      const y = this.latestActual(c);
      if (!y || y.net_income == null) continue;   // no comparable net income → out of scope
      N++;
      const { value, basis } = this.aiShare(c, y);
      if (value == null) continue;                 // fallback B: drop, never impute 0
      basisCount[basis] = (basisCount[basis] || 0) + 1;
      rows.push({ id: c.id, name: c.name, stage: stageOf(c), ni: y.net_income * value, asOf: this._yearOf(y), aiShare: value, basis });
    }
    const total = rows.reduce((s, r) => s + r.ni, 0);
    const byStage = this._aggregateStages(rows, total).map(s => ({
      ...s,
      companies: s.companies.map(m => {
        const src = rows.find(r => r.id === m.id);
        return { id: m.id, name: m.name, ni: m.ni, aiShare: src ? src.aiShare : null, basis: src ? src.basis : null };
      }),
    }));
    return { label: "AI 加权利润池(C 口径)", total, n: rows.length, N, byStage, basisCount };
  },

  /* ---- profit-pool migration (value-chain stacked, AI-weighted, per-company coverage) ----
     ADR-2: NO "all-samples-complete" gate. Aligns companies by "position from latest
     actual year" (pos 0 = newest actual, pos 1 = prior, …), reusing actualYears reversed.
     Each company is included at a position whenever it HAS an actual year there with a
     non-null net_income AND a non-null aiShare(c, thatYear).value — otherwise it is simply
     absent from that position (honest per-company coverage), never imputed. Net income is
     AI-WEIGHTED (ni × aiShare.value) to match the hero pool口径 (ADR-3). Each position
     carries {n, N}: N = companies that have an actual year at that position (coverage
     denominator); n = of those, how many contributed (valid aiShare). Returns positions
     chronological (old→new). Year alignment prefers year.period_end_iso, falling back to
     the legacy free-text period_end regex (_yearOf). Net may be negative (downcycle);
     share = value/total as-is when total>0, the view renders negatives. */
  profitPoolMigration(companies) {
    const list = companies || [];
    // per-company actual years, newest-first, so index = position-from-latest
    const byCo = list.map(c => ({ c, ys: this.actualYears(c).slice().reverse() }));
    const maxPos = byCo.reduce((m, x) => Math.max(m, x.ys.length), 0);

    const positions = [];
    for (let pos = 0; pos < maxPos; pos++) {
      const rows = [];
      let N = 0;
      for (const { c, ys } of byCo) {
        const y = ys[pos];
        if (!y || y.net_income == null) continue;       // no comparable year here → not in coverage
        N++;
        const share = this.aiShare(c, y).value;
        if (share == null) continue;                    // valid year but no aiShare → drop (not imputed)
        rows.push({ id: c.id, name: c.name, stage: stageOf(c), ni: y.net_income * share, year: this._yearOf(y) });
      }
      if (!rows.length) continue;                         // nothing to show at this position

      const total = rows.reduce((s, r) => s + r.ni, 0);
      const stages = this._aggregateStages(rows, total);

      positions.push({
        pos,
        label: "≈" + this._modeYear(rows.map(r => r.year)),
        total,
        stages,
        n: rows.length,
        N,
      });
    }
    return positions.reverse(); // chronological: old → new
  },

  /* ---- Home hero 组合派生:龙头占比 / 利润池同比 ----
     两者是对 profitPoolAI / profitPoolMigration 已算好输出的再组合。归并到此唯一派生
     边界(不在视图组件里算——不变量5:视图无计算)。均 null-safe:分母缺失/≤0 → null
     (诚实留空,绝不伪造 0)。口径与 hero 池、迁移图三者完全一致。 */

  /* 龙头(AI 加权后净利最高的公司)及其占 AI 加权池比重;pool = profitPoolAI.total。
     返回 {leader, share, pool, n, N, basisCount};无贡献者 → leader=null、share=null。 */
  profitPoolLeader(companies) {
    const ai = this.profitPoolAI(companies);
    const cos = ai.byStage.flatMap(s => s.companies).slice().sort((a, b) => b.ni - a.ni);
    const leader = cos.length ? cos[0] : null;
    const share = (leader && ai.total > 0) ? leader.ni / ai.total : null;
    return { leader, share, pool: ai.total, n: ai.n, N: ai.N, basisCount: ai.basisCount };
  },

  /* 利润池同比:迁移图最新位置 total 相对上一位置 total(与池子、迁移图三者同口径)。
     返回 {value, migLast, migPrev};不足两位置或上一位置 total≤0 → value=null(基期无意义)。 */
  profitPoolYoY(companies) {
    const mig = this.profitPoolMigration(companies);
    const migLast = mig.length ? mig[mig.length - 1] : null;
    const migPrev = mig.length > 1 ? mig[mig.length - 2] : null;
    const value = (migLast && migPrev && migPrev.total > 0)
      ? (migLast.total - migPrev.total) / migPrev.total
      : null;
    return { value, migLast, migPrev };
  },

  /* extract a 4-digit year from a year record — prefer machine-readable period_end_iso
     (ADR-2), fall back to a regex over the free-text period_end. null-safe. */
  _yearOf(y) {
    if (y && typeof y.period_end_iso === "string") {
      const mi = y.period_end_iso.match(/(\d{4})/);
      if (mi) return mi[1];
    }
    const m = (y && typeof y.period_end === "string") ? y.period_end.match(/(\d{4})/) : null;
    return m ? m[1] : null;
  },
  /* most-frequent value (ties → first seen); ignores null */
  _modeYear(years) {
    const counts = new Map();
    let best = null, bestN = 0;
    for (const y of years) {
      if (y == null) continue;
      const n = (counts.get(y) || 0) + 1;
      counts.set(y, n);
      if (n > bestN) { bestN = n; best = y; }
    }
    return best;
  },
};

/* Allow reuse in Node (validator/tests) as well as the browser */
if (typeof module !== "undefined" && module.exports) module.exports = { Store, Selectors, STAGE_OF_FALLBACK, STAGE_ORDER, STAGE_LABEL, STAGE_COLOR, stageOf, _refreshStages };
