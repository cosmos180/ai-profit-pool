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
  // null-safe: a company without a years[] array (e.g. a periods-only synthetic, or a
  // future company migrated to periods[] before years[] backfill) yields [] rather than
  // throwing — so aiShare/latestActual stay safe when called from companyMetricView.
  actualYears(c)   { return (c && Array.isArray(c.years) ? c.years : []).filter(y => y.status === "actual"); },
  forecastYear(c)  { return c.years.find(y => y.status === "forecast"); },
  // 服务年度视图/首页 headline 与 AI 池链 (aiShare 的年份锚); 估值链已迁 latestActualAnnual, 不再消费。
  latestActual(c)  { const a = this.actualYears(c); return a.length ? a[a.length - 1] : null; },
  yearIndex(c, fy) { return c.years.findIndex(y => y.fy === fy); },
  yearByFy(c, fy)  { return c.years.find(y => y.fy === fy); },

  revYoY(c, fy) {
    const i = this.yearIndex(c, fy);
    if (i <= 0) return null;
    const a = c.years[i - 1].revenue, b = c.years[i].revenue;
    return a ? (b - a) / a : null;
  },

  /* ---- hierarchical revenue disaggregation (product / revenue type) ----
     Separate from segments[] on purpose: a filing can disclose product revenue at a
     finer grain than reportable-segment operating profit (Alphabet/YouTube).  The
     hierarchy is raw data; flattening, shares and YoY are derived here for the view. */
  revenueBreakdown(y) {
    return y && y.revenue_breakdown && Array.isArray(y.revenue_breakdown.items)
      ? y.revenue_breakdown
      : null;
  },

  /* 拆分的口径元信息（视图文案分流用，组件不做 provenance 判断）：
     official = sources 非空且全部 data_status==="official"；complete 透传布尔。
     非 official（如 tsmc %×营收 derived）或 complete=false 时，视图不得宣称
     「官方」「已与营收对账」。 */
  revenueBreakdownMeta(y) {
    const breakdown = this.revenueBreakdown(y);
    if (!breakdown) return null;
    const statuses = (breakdown.sources || []).map(s => s && s.data_status).filter(Boolean);
    return {
      label: breakdown.label,
      complete: breakdown.complete === true,
      official: statuses.length > 0 && statuses.every(s => s === "official"),
    };
  },

  revenueBreakdownRows(y) {
    const breakdown = this.revenueBreakdown(y);
    if (!breakdown) return [];
    const rows = [];
    const walk = (items, depth, parentPath) => {
      for (const item of items) {
        const path = parentPath ? `${parentPath} / ${item.name}` : item.name;
        const children = Array.isArray(item.children) ? item.children : [];
        rows.push({
          name: item.name,
          path,
          depth,
          revenue: item.revenue,
          share: y.revenue ? item.revenue / y.revenue : null,
          hasChildren: children.length > 0,
        });
        if (children.length) walk(children, depth + 1, path);
      }
    };
    walk(breakdown.items, 0, "");
    return rows;
  },

  revenueBreakdownItem(y, path) {
    if (!path) return null;
    return this.revenueBreakdownRows(y).find(item => item.path === path) || null;
  },

  revenueBreakdownYoY(c, fy, path) {
    const i = this.yearIndex(c, fy);
    if (i <= 0) return null;
    const prev = this.revenueBreakdownItem(c.years[i - 1], path);
    const cur = this.revenueBreakdownItem(this.yearByFy(c, fy), path);
    return (prev && cur && prev.revenue) ? (cur.revenue - prev.revenue) / prev.revenue : null;
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
       cogs/grossProfit  from gross_profit when present; otherwise gross_margin
                         (both null only if neither input exists)
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

    const grossProfit = (y.gross_profit != null)
      ? y.gross_profit
      : (y.gross_margin != null ? revenue * y.gross_margin : null);
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

  /* ---- valuation (single-slice market snapshot vs latest actual annual period) ----
     quote.market_cap is the ONLY cross-currency-safe value (already USD bn, same 口径
     as revenue/net_income) — use it directly, never multiply by FX.
     valuation_caveat三态: 'na' → 整项留空(null); 'distorted' → 照常返回数值(供视图警示);
     'ok'/缺省 → 正常。所有倍数 null-safe，分母统一用 latestActualAnnual(periods 侧最新实际年)。 */
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
     'distorted'（如软银投资控股）仍出值，供视图警示。分母统一用 latestActualAnnual。 */
  evSales(c) {
    if (this.valuationCaveat(c, "ev_sales") === "na") return null;
    const e = this.ev(c), y = this.latestActualAnnual(c);
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
    const mc = this.marketCap(c), y = this.latestActualAnnual(c);
    return (mc != null && y && y.net_income) ? mc / y.net_income : null;
  },
  ps(c) {
    if (this.valuationCaveat(c, "ps") === "na") return null;
    const mc = this.marketCap(c), y = this.latestActualAnnual(c);
    return (mc != null && y && y.revenue) ? mc / y.revenue : null;
  },
  fcfYield(c) {
    if (this.valuationCaveat(c, "fcf_yield") === "na") return null;
    // FCF from the latest annual actual period that carries cash inputs (capex/cfo lag the headline
    // year), mirroring latestCashYear's intent on the periods side (see latestCashActualAnnual).
    const mc = this.marketCap(c), f = this.fcf(this.latestCashActualAnnual(c));
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
  /* latest actual year that carries cash inputs (capex/cfo may lag the headline year).
     服务 homeMetric 的 fcfMargin/capexInt (年度口径); 估值链 fcfYield 已迁 latestCashActualAnnual, 不再消费。 */
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
     Revenue-only / guidance-only quarter atoms are ignored here: they can live in
     quarters[] for traceability, but net-income TTM only rolls from quarters that
     actually carry net_income.
     Returns null (honest gap) if required net-income atoms are missing:
       no latest complete FY net_income / no paired post-FY net-income quarter /
       no ~365d-ago net-income match for some add-on quarter. */
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
  _datedNetIncomeQuarters(c) {
    return this._datedQuarters(c).filter(x => x.q.net_income != null);
  },

  /* Audit-only legacy TTM path. Kept for historical reconciliation of years[] /
     quarters[] snapshots, but no UI consumption path should call this after
     Phase 6 final. Runtime TTM now uses ttmNetIncomeUnified(c), which is
     periods-only. */
  ttmNetIncome(c) {
    if (!c) return null;
    // anchor on the latest COMPLETE fiscal year with a non-null net_income
    const fy = this.latestActual(c);
    if (!fy || fy.net_income == null) return null;

    const dq = this._datedNetIncomeQuarters(c);
    if (!dq.length) return null;                       // no quarters → cannot self-roll → null (honest)

    // Add-on quarters = the post-FY-end quarters, identified PURELY by date pairing
    // (never by parsing label or the free-text years[].period_end):
    // a quarter is an add-on iff it has a ~365-day-EARLIER counterpart also in the set
    // (that earlier counterpart is the in-FY year-ago quarter we subtract).
    // 关键修复(dense-series bug):早期数据只录「新季+孪生季」,「有更早孪生」即等价于
    // 「财年后新季」;但 Dayu 补齐 8 连季后,财年内的季也有孪生,会被误当增量累加 →
    // TTM 系统性高估(google 曾 190.95 vs 真值 160.21)。恢复注释本意:当锚定财年带
    // 机读 period_end_iso 时,add-on 还必须严格晚于财年末;无 ISO 的老数据(稀疏录入)
    // 保持原判据不变(其 add-on 本就都在财年后,行为不受影响)。
    const fyEndT = this._parseDate(fy.period_end_iso);
    const addOns = dq.filter(x => {
      if (fyEndT != null && x.t <= fyEndT) return false;   // 财年内的季绝不是增量季
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

  /* as-of date (ISO string) of the latest quarter carrying net_income, or null */
  ttmAsOf(c) {
    const dq = this._datedNetIncomeQuarters(c);
    return dq.length ? dq[dq.length - 1].q.period_end : null;
  },

  /* =====================================================================
     Period-base layer (period-base refactor · Phase 2). Report-period base
     facts live in c.periods[]; fiscal-year / calendar-year / TTM / latest-quarter
     views are DERIVED here (算不存), never stored — a fiscal year is NEVER
     rewritten as a calendar year. These selectors prefer c.periods; legacy
     quarters[] synthesis is retained only for old compatibility views and tests.
     Runtime TTM consumption is periods-only via ttmNetIncomeUnified(c).
     calendar_quarter of a synthesized period is ceil(month/3) of period_end
     (date math, not the free-text label).
     KNOWN LIMITATION (synth status): legacy quarters[] carry no status field, so
     every synthesized period is status="actual". Samsung's Q2'26 guidance atom
     currently lives in quarters[] (net_income=null, has revenue/op_income); until
     Phase 3.1 converts Samsung to real periods[] with status="guidance", the synth
     path treats it as actual (so latestQuarter can pick it). The UI does not consume
     periods[] until Phase 4, so this has no user-visible effect. Tested + noted below.
     All selectors null-safe.
     ===================================================================== */
  PERIOD_METRICS: ["revenue", "op_income", "net_income", "cfo", "capex"],
  CAL_QUARTERS: ["Q1", "Q2", "Q3", "Q4"],

  /* calendar quarter (Q1..Q4) from an ISO date's END MONTH — pure date math
     (ceil(month/3)), NOT label parsing. null if unparseable. */
  _calQuarterOf(iso) {
    const t = this._parseDate(iso);
    if (t == null) return null;
    return "Q" + Math.ceil((new Date(t).getUTCMonth() + 1) / 3);
  },
  _calYearOf(iso) {
    const t = this._parseDate(iso);
    return t == null ? null : new Date(t).getUTCFullYear();
  },
  /* ISO date + n days → ISO (UTC, YYYY-MM-DD). null if unparseable. */
  _addDaysISO(iso, n) {
    const t = this._parseDate(iso);
    if (t == null) return null;
    return new Date(t + n * this.DAY_MS).toISOString().slice(0, 10);
  },

  /* Synthesize a period-like object from a legacy quarter atom. status is ALWAYS
     "actual" (legacy quarters have no status field — see KNOWN LIMITATION above).
     Dates/tags come purely from period_end date math; financial fields carry over. */
  _synthPeriodFromQuarter(q) {
    const pe = q.period_end;
    return {
      period_id: q.label || pe || null,
      kind: "quarter",
      status: "actual",
      period_start: null,
      period_end: pe,
      calendar_year: this._calYearOf(pe),
      calendar_quarter: this._calQuarterOf(pe),
      fiscal_year: null,
      fiscal_quarter: null,
      currency: null,
      fx_to_usd: null,
      revenue: q.revenue != null ? q.revenue : null,
      gross_profit: null,
      op_income: q.op_income != null ? q.op_income : null,
      net_income: q.net_income != null ? q.net_income : null,
      cfo: null,
      capex: null,
      segments: [],
      sources: q.sources || [],
      _synth: true,
    };
  },

  /* All periods for a company, sorted oldest→newest by period_end. Prefers
     c.periods; falls back to synthesizing from quarters[] (date-math only).
     Periods without a parseable period_end are dropped (cannot be date-aligned). */
  periods(c) {
    if (!c) return [];
    const src = Array.isArray(c.periods) && c.periods.length
      ? c.periods.slice()
      : (c.quarters || []).map(q => this._synthPeriodFromQuarter(q));
    return src
      .map(p => ({ p, t: this._parseDate(p.period_end) }))
      .filter(x => x.t != null)
      .sort((a, b) => a.t - b.t)
      .map(x => x.p);
  },

  actualPeriods(c)  { return this.periods(c).filter(p => p.status === "actual"); },
  quarterPeriods(c) { return this.periods(c).filter(p => p.kind === "quarter"); },

  /* a period carries a financial fact if any monetary field is non-null */
  _hasFinancialFact(p) {
    return !!p && (p.revenue != null || p.gross_profit != null || p.op_income != null
      || p.net_income != null || p.cfo != null || p.capex != null);
  },

  /* Latest ACTUAL quarter carrying at least one financial fact (guidance excluded).
     null when none. */
  latestQuarter(c) {
    const qs = this.actualPeriods(c).filter(p => p.kind === "quarter" && this._hasFinancialFact(p));
    return qs.length ? qs[qs.length - 1] : null;
  },

  /* 估值链分母源 (B1-migrated: periods-only, 禁止改回 latestActual)。
     latestActualAnnual(c) → periods 侧「最新实际年」= 最新(periods 已按 period_end 升序 → 取末位)
     满足 kind==="annual" && status==="actual" 的 period 对象; 无此类 period → null。
     不回退 years[], 不借季度合成 —— 无 annual period 时 pe/ps/evSales 诚实留空。算不存。 */
  latestActualAnnual(c) {
    const anns = this.periods(c).filter(p => p.kind === "annual" && p.status === "actual");
    return anns.length ? anns[anns.length - 1] : null;
  },
  /* fcfYield 专用现金年 (B1-migrated: periods-only, 禁止改回 latestCashYear)。
     latestCashActualAnnual(c) → 从 annual actual periods 里自新到旧, 第一个 cfo!=null || capex!=null
     者 (现金字段常滞后 headline 年, 镜像 latestCashYear 语义); 皆无 → null。算不存。 */
  latestCashActualAnnual(c) {
    const anns = this.periods(c).filter(p => p.kind === "annual" && p.status === "actual");
    for (let i = anns.length - 1; i >= 0; i--) {
      if (anns[i].cfo != null || anns[i].capex != null) return anns[i];
    }
    return null;
  },

  /* Coverage summary for the period set (completeness metadata; view echoed).
     Lightweight & null-safe — a fuller per-view coverage (missing_periods /
     missing_metric / missing_ai_share) lands with the Phase 4 view model. */
  periodCoverage(c, view) {
    const all = this.periods(c);
    const q = all.filter(p => p.kind === "quarter");
    const latest = this.latestQuarter(c);
    return {
      view: view != null ? view : null,
      source: (c && Array.isArray(c.periods) && c.periods.length) ? "periods" : "quarters",
      total: all.length,
      actualQuarters: q.filter(p => p.status === "actual").length,
      guidanceQuarters: q.filter(p => p.status === "guidance").length,
      annual: all.filter(p => p.kind === "annual").length,
      latestQuarterEnd: latest ? latest.period_end : null,
    };
  },

  /* ---- Implied fiscal-Q4 (DEFAULT策略, 用户拍板 2026-07-07) ----
     impliedQ4 = annual actual − (fiscal Q1+Q2+Q3 actual). 派生算不存 —— 在 selector 层算出一个
     季度形状的 Q4 占位期, 打 basis="implied_q4" / confidence="derived_from_official", 绝不写回
     companies.json。返回 null（留空也比伪造好）当以下 HARD CONSTRAINTS 有任一不满足:
       · 该 fiscal_year 存在 kind=annual & status=actual 的年度期;
       · 该 FY 的 fiscal Q1/Q2/Q3 都存在 (kind=quarter & status=actual);
       · 口径一致: annual 与三个季度同 currency 且同 fx_to_usd（混 FX/币种口径相减无意义 → null）。
     只对【可加总流量指标】做减法 (revenue/gross_profit/op_income/net_income/cfo/capex);
     EPS / margin / AI share / 估值倍数 永不相减。某指标在 annual 或任一季缺失 → 该指标 null
     (诚实的逐指标缺口)。分部 Q4 仅当 annual 与 Q1-Q3 都带【同一套 segment key 集】(按 name)
     才逐分部相减 revenue, 否则 segments:[] (绝不给部分/臆造的分部集)。
     消费方优先级阶梯: actual reported quarter > implied Q4 > guidance > null。 */
  IMPLIED_Q4_METRICS: ["revenue", "gross_profit", "op_income", "net_income", "cfo", "capex"],

  impliedQ4(c, fy) {
    if (!c || fy == null) return null;
    const all = this.periods(c);
    const annual = all.find(p => p.kind === "annual" && p.status === "actual" && p.fiscal_year === fy);
    if (!annual) return null;                                  // 无年度 actual → 无从相减
    const q = {};
    for (const p of all) {
      if (p.kind === "quarter" && p.status === "actual" && p.fiscal_year === fy
          && (p.fiscal_quarter === "Q1" || p.fiscal_quarter === "Q2" || p.fiscal_quarter === "Q3")) {
        q[p.fiscal_quarter] = p;                               // 排序升序 → 同键后者覆盖, 无害
      }
    }
    const q1 = q.Q1, q2 = q.Q2, q3 = q.Q3;
    if (!q1 || !q2 || !q3) return null;                        // 三季不齐 → null
    // 口径一致性: annual + Q1-Q3 同币同 fx（否则相减无意义）
    const cur = annual.currency, fx = annual.fx_to_usd;
    for (const p of [q1, q2, q3]) {
      if (p.currency !== cur || p.fx_to_usd !== fx) return null;
    }
    const out = {
      period_id: `${c.id || "?"}-${fy}-impliedq4`,
      kind: "quarter", status: "actual",
      period_start: this._addDaysISO(q3.period_end, 1),        // 链内推导: Q3 末 +1 天
      period_end: annual.period_end,                           // 财年末
      calendar_year: annual.calendar_year != null ? annual.calendar_year : this._calYearOf(annual.period_end),
      calendar_quarter: this._calQuarterOf(annual.period_end),
      fiscal_year: fy, fiscal_quarter: "Q4",
      currency: cur, fx_to_usd: fx,
      basis: "implied_q4", confidence: "derived_from_official",
      segments: [],
      sources: [...(annual.sources || []), ...(q1.sources || []), ...(q2.sources || []), ...(q3.sources || [])],
      _implied: true,
    };
    for (const m of this.IMPLIED_Q4_METRICS) {
      const av = annual[m], v1 = q1[m], v2 = q2[m], v3 = q3[m];
      out[m] = (av != null && v1 != null && v2 != null && v3 != null) ? av - (v1 + v2 + v3) : null;
    }
    // 分部 Q4: 仅当 annual 与 Q1-Q3 同一套 segment key 集（按 name）才逐分部推 revenue
    const keyset = (p) => new Set((p.segments || []).map(s => s.name));
    const aKeys = keyset(annual);
    const sameKeys = (p) => { const k = keyset(p); return k.size === aKeys.size && [...k].every(x => aKeys.has(x)); };
    if (aKeys.size && sameKeys(q1) && sameKeys(q2) && sameKeys(q3)) {
      const byName = (p, name) => (p.segments || []).find(s => s.name === name);
      out.segments = [...aKeys].map(name => {
        const a = byName(annual, name), s1 = byName(q1, name), s2 = byName(q2, name), s3 = byName(q3, name);
        const rev = (a.revenue != null && s1.revenue != null && s2.revenue != null && s3.revenue != null)
          ? a.revenue - (s1.revenue + s2.revenue + s3.revenue) : null;
        return { name, kind: a.kind, revenue: rev, is_ai: !!a.is_ai };
      });
    }
    return out;
  },

  /* Actual quarter periods PLUS derivable implied-Q4 placeholders, in ONE date-sorted list,
     each tagged _basis ("actual" | "implied_q4"). An implied Q4 is inserted ONLY when its
     calendar-quarter slot is not already held by an actual quarter (priority ladder:
     actual > implied). Continuity/TTM treat the implied Q4 as a real placeholder quarter. */
  _quartersWithImpliedQ4(c) {
    const actual = this.actualPeriods(c)
      .filter(p => p.kind === "quarter")
      .map(p => Object.assign({}, p, { _basis: "actual" }));
    const occupied = new Set();
    for (const p of actual) { const i = this._quarterIndex(p); if (i != null) occupied.add(i); }
    const fys = [];
    for (const p of this.periods(c)) {
      if (p.kind === "annual" && p.status === "actual" && p.fiscal_year && !fys.includes(p.fiscal_year)) fys.push(p.fiscal_year);
    }
    const merged = actual.slice();
    for (const fy of fys) {
      const iq4 = this.impliedQ4(c, fy);
      if (!iq4) continue;
      const i = this._quarterIndex(iq4);
      if (i == null || occupied.has(i)) continue;              // actual 已占该季 → 不重复插 (actual 优先)
      occupied.add(i);
      merged.push(Object.assign({}, iq4, { _basis: "implied_q4" }));
    }
    return merged
      .map(p => ({ p, t: this._parseDate(p.period_end) }))
      .filter(x => x.t != null)
      .sort((a, b) => a.t - b.t)
      .map(x => x.p);
  },

  /* Derive a NATURAL (calendar) year from quarterly period facts.
     Uses ONLY kind=quarter && status=actual periods with calendar_year===year,
     keyed off calendar_quarter (so a fiscal-year-shifted company still yields the
     right CY). complete=true iff all of Q1-Q4 present. A metric is summed ONLY if
     all four quarters carry it non-null; otherwise that metric is null (chosen
     representation: complete reflects QUARTER coverage, each metric independently
     null on any gap). guidance never participates. basis:"periods". */
  CY_STRICT_TOL_DAYS: 4,   // 严格 CY 边界容差: 拼接后端点须落在 YYYY-01-01 / YYYY-12-31 的 ±4 天内
                           // (吸收季历末日的自然浮动, 如 3-31/6-30/9-30/12-31 与实际报告期末微差)

  calendarYear(c, year) {
    const out = {
      label: "CY" + year, year, complete: false, missing: this.CAL_QUARTERS.slice(),
      revenue: null, op_income: null, net_income: null, cfo: null, capex: null,
      sources: [], basis: "periods",
      // 严格 CY 边界 (用户拍板 2026-07-07): strict=true 仅当四季 [start,end] 拼接完整覆盖
      // 自然年首尾; 覆盖不可验证 (period_start 缺) 或财年错位拼不满 → strict=false 的
      // "reporting-period CY proxy" (仍出值, 由 strict/coverage_* 显式标注, 视图负责灰显带因)。
      strict: false, coverage_start: null, coverage_end: null, coverage: {},
    };
    if (!c || year == null) return out;
    const qs = this.actualPeriods(c)
      .filter(p => p.kind === "quarter" && p.calendar_year === year && p.calendar_quarter);
    const byQ = {}, basisByQ = {};
    for (const p of qs) { byQ[p.calendar_quarter] = p; basisByQ[p.calendar_quarter] = "actual"; } // sorted asc → latest wins on dup

    // implied Q4 补全 (按 calendar slot, 用户拍板 hotfix 2026-07-07): 每个财年的 implied fiscal-Q4
    // 有明确 period_start/period_end → 按它落入的 calendar 季补, 而非硬编码 calendar Q4。
    //   · 自然年公司 (google/amazon): implied 落 calendar Q4 → 行为不变。
    //   · 财年错位公司 (MSFT 6月末财年): implied fiscal Q4 落 calendar Q2 2025 → 补 Q2 槽,
    //     否则会错误地报 CY2025 缺 Q2。Oracle 月度错位 (2/5/8/11 月末) 同理补齐, complete=true
    //     但下面 strict 由 period_start/period_end 覆盖判断 → strict=false (自然年近似)。
    // 只在 iq4 落在本 targetYear、其 calendar slot 尚空 (actual 未占) 时插 (优先级不变: actual > implied)。
    const fys = [];
    for (const p of this.periods(c)) {
      if (p.kind === "annual" && p.status === "actual" && p.fiscal_year && !fys.includes(p.fiscal_year)) fys.push(p.fiscal_year);
    }
    for (const fy of fys) {
      const iq4 = this.impliedQ4(c, fy);
      if (iq4 && iq4.calendar_year === year && iq4.calendar_quarter && !byQ[iq4.calendar_quarter]) {
        byQ[iq4.calendar_quarter] = iq4;
        basisByQ[iq4.calendar_quarter] = "implied_q4";
      }
    }

    const present = this.CAL_QUARTERS.filter(q => byQ[q]);
    out.missing = this.CAL_QUARTERS.filter(q => !byQ[q]);
    out.complete = out.missing.length === 0;
    for (const q of present) out.coverage[q] = basisByQ[q];
    out.sources = present.flatMap(q => byQ[q].sources || []);
    if (Object.values(basisByQ).includes("implied_q4")) out.basis = "implied_q4";
    if (!out.complete) return out;
    for (const m of this.PERIOD_METRICS) {
      const vals = this.CAL_QUARTERS.map(q => byQ[q][m]);
      out[m] = vals.every(v => v != null) ? vals.reduce((s, v) => s + v, 0) : null;
    }
    // 严格 CY 边界: 四季 period_start/period_end 拼接须覆盖 [year-01-01, year-12-31] (±容差)。
    // 任一 period_start 缺 (synth 路径) → 无法验证覆盖 → 至多 proxy (strict=false)。
    const startTs = this.CAL_QUARTERS.map(q => this._parseDate(byQ[q].period_start));
    const endTs = this.CAL_QUARTERS.map(q => this._parseDate(byQ[q].period_end));
    if (startTs.every(t => t != null)) out.coverage_start = new Date(Math.min(...startTs)).toISOString().slice(0, 10);
    if (endTs.every(t => t != null)) out.coverage_end = new Date(Math.max(...endTs)).toISOString().slice(0, 10);
    if (out.coverage_start && out.coverage_end) {
      const jan1 = this._parseDate(year + "-01-01"), dec31 = this._parseDate(year + "-12-31");
      const tol = this.CY_STRICT_TOL_DAYS * this.DAY_MS;
      out.strict = Math.abs(Math.min(...startTs) - jan1) <= tol && Math.abs(Math.max(...endTs) - dec31) <= tol;
    }
    return out;
  },

  /* calendar-quarter INDEX of a period = calendar_year*4 + (Qn-1), so consecutive
     reported quarters differ by exactly 1 — robust across fiscal-year-shifted
     companies (NVDA Apr/Jul/Oct/Jan → Q2,Q3,Q4,Q1 still index-consecutive). Uses
     the stored calendar tags, falling back to period_end date math when absent
     (synth path already fills these). null when neither is derivable. */
  _quarterIndex(p) {
    if (!p) return null;
    const y = p.calendar_year != null ? p.calendar_year : this._calYearOf(p.period_end);
    const cq = p.calendar_quarter || this._calQuarterOf(p.period_end);
    const qn = cq ? Number(cq.slice(1)) : NaN;
    if (y == null || !(qn >= 1 && qn <= 4)) return null;
    return y * 4 + (qn - 1);
  },

  /* TTM for a metric from the latest FOUR actual quarters (period-base).
     CONTINUITY-GUARDED: the latest four actual quarters must be strictly
     consecutive calendar quarters (index step 1) so they cover EXACTLY ~12 months.
     A non-contiguous window (e.g. Q1,Q3,Q4,Q1 spanning 13 months) is NOT a real
     TTM — return value=null with a `gap` note rather than silently summing a wrong
     number (留空也比填错好). When contiguous, all four must carry the metric non-null;
     otherwise value=null (contiguous=true, gap=null). Does NOT anchor to latestActual.
     <4 actual quarters → null (contiguous=false, gap=null; a coverage shortfall, not a hole).
     STRUCTURAL FACT: US filers issue no standalone 10-Q for their fiscal Q4 — the 4th
     quarter is implicit in the 10-K, so implied Q4 placeholders may be derived from
     official annual minus Q1-Q3 when the hard constraints pass.
     Returns { metric, value, complete, quarters, asOf, contiguous, gap }. */
  ttmFromPeriods(c, metric) {
    // 组合季 = actual 季 + 可派生的 implied Q4 占位季 (优先级: actual > implied Q4)。implied Q4
    // 参与连号判断 (当作真实占位季), 补上美股财年末系统性缺失的第四季。无年度期/凑不齐硬约束 →
    // 无 implied → 退化为纯 actual 序列 (行为不变)。
    const qs = this._quartersWithImpliedQ4(c);
    const last4 = qs.slice(-4);
    const out = {
      metric, value: null, complete: false, quarters: qs.length,
      asOf: last4.length ? last4[last4.length - 1].period_end : null,
      contiguous: false, gap: null,
      basis: last4.map(p => p._basis || "actual"),                 // 每季来源: actual | implied_q4
      usedImpliedQ4: last4.some(p => p._basis === "implied_q4"),
    };
    if (last4.length < 4) return out;                    // not enough quarters (coverage shortfall, not a gap)
    // continuity: consecutive calendar-quarter indices, else report the first hole
    const idx = last4.map(p => this._quarterIndex(p));
    for (let i = 0; i < idx.length - 1; i++) {
      if (idx[i] == null || idx[i + 1] == null) {
        out.gap = `无法判定连续性（${last4[i].period_end} 或 ${last4[i + 1].period_end} 缺日历季标记）`;
        return out;
      }
      if (idx[i + 1] !== idx[i] + 1) {
        const miss = idx[i + 1] - idx[i] - 1;
        out.gap = `${last4[i].period_end} 与 ${last4[i + 1].period_end} 之间缺 ${miss} 季`;
        return out;                                      // non-contiguous → null, never a wrong sum
      }
    }
    out.contiguous = true;
    const vals = last4.map(p => p[metric]);
    if (!vals.every(v => v != null)) return out;         // metric gap in the window → value null (contiguous but incomplete)
    out.value = vals.reduce((s, v) => s + v, 0);
    out.complete = true;
    return out;
  },

  /* ---- TTM net income, UNIFIED (period-base refactor · Phase 6 final, 算不存) ----
     TTM 口径统一入口: 只认真实 periods[] (含 implied Q4), 不再回退 legacy
     years[]/quarters[]。旧 ttmNetIncome(c) 仅作审计对账保留, 从 UI 消费路径摘除。
     阶梯 (优先级): periods (complete 且 value 非 null) > null。
     全 null 安全。Returns { value, basis, asOf, coverage }:
       · basis="periods":          coverage 透传 periods 侧 quarter_basis[]/usedImpliedQ4/quarters/contiguous;
       · basis=null (皆无):         value=null, coverage.reason="no_ttm"。 */
  ttmNetIncomeUnified(c) {
    if (!c) return { value: null, basis: null, asOf: null, coverage: { reason: "no_company" } };
    if (!Array.isArray(c.periods) || !c.periods.length) {
      return { value: null, basis: null, asOf: null, coverage: { reason: "no_periods" } };
    }
    const p = this.ttmFromPeriods(c, "net_income");
    if (p.complete && p.value != null) {
      return {
        value: p.value,
        basis: "periods",
        asOf: p.asOf,
        coverage: {
          quarter_basis: p.basis,          // 每季来源: actual | implied_q4
          usedImpliedQ4: p.usedImpliedQ4,
          quarters: p.quarters,
          contiguous: p.contiguous,
        },
      };
    }
    return { value: null, basis: null, asOf: null, coverage: { reason: "no_ttm", quarters: p.quarters, gap: p.gap } };
  },

  /* Company-reported FISCAL year from periods (period-base).
     If a kind=annual period with matching fiscal_year exists → official full-year
     fact wins (basis="annual_report", complete). Else sum actual quarters sharing
     that fiscal_year (basis="quarter_sum"), complete iff four actual quarters
     present; a metric sums only when complete AND all four carry it non-null, else
     null. Mixed actual/guarterly-guidance never completes: guidance quarters are
     excluded from the sum, so a fiscal year holding a guidance quarter stays <4
     actual → incomplete.
     NOTE on implied Q4: fiscalYearFromPeriods intentionally does NOT synthesize an
     implied Q4. implied Q4 = annual − (Q1+Q2+Q3), so it can only exist when an annual
     period exists — and when it does, the annual_report branch below already returns the
     official full-year fact directly (strictly better than reconstructing it from a
     difference). So there is no reachable gap for implied Q4 to fill here; the ladder
     (annual_report > quarter_sum) subsumes it. (calendarYear / ttmFromPeriods DO use
     implied Q4, where an annual can complete a calendar/rolling window the quarters miss.)
     Returns
     { fy, label, basis, complete, revenue, op_income, net_income, cfo, capex, quarters, sources }. */
  fiscalYearFromPeriods(c, fy) {
    const out = {
      fy, label: fy, basis: null, complete: false,
      revenue: null, op_income: null, net_income: null, cfo: null, capex: null,
      quarters: 0, sources: [],
    };
    if (!c || fy == null) return out;
    const all = this.periods(c);
    const annual = all.find(p => p.kind === "annual" && p.status === "actual" && p.fiscal_year === fy)
                || all.find(p => p.kind === "annual" && p.fiscal_year === fy);
    if (annual) {
      out.basis = "annual_report";
      out.complete = true;
      for (const m of this.PERIOD_METRICS) out[m] = annual[m] != null ? annual[m] : null;
      out.sources = annual.sources || [];
      return out;
    }
    const qs = all.filter(p => p.kind === "quarter" && p.status === "actual" && p.fiscal_year === fy);
    out.basis = "quarter_sum";
    out.quarters = qs.length;
    out.sources = qs.flatMap(q => q.sources || []);
    out.complete = qs.length === 4;
    if (!out.complete) return out;
    for (const m of this.PERIOD_METRICS) {
      const vals = qs.map(q => q[m]);
      out[m] = vals.every(v => v != null) ? vals.reduce((s, v) => s + v, 0) : null;
    }
    return out;
  },

  /* =====================================================================
     Phase 4 view model — companyMetricView(c, mode, opts). ONE dumb-view-ready
     projection per reporting lens, so Svelte components stay calculation-free.
     mode ∈ latestQuarter | ttm | calendarYear | fiscalYear; each DELEGATES to the
     existing period selector (latestQuarter / ttmFromPeriods / calendarYear /
     fiscalYearFromPeriods). ttm runs ttmFromPeriods once PER metric (revenue /
     op_income / net_income), each independently null.
     AI attribution stays COMPANY-LEVEL (Decision Addendum): aiShare = aiShare(c).value;
     aiShare null → aiWeightedNetIncome null (NEVER 0).
     HONEST EMPTY (biggest edge case this round): a company NOT yet migrated to a real
     periods[] returns complete=false with coverage.missing_periods + reason
     "not_migrated" — it is NEVER faked from years[]/quarters[] synth here. (The synth
     path in periods() is backward-compat plumbing for the lower selectors; the Phase 4
     lens deliberately requires genuine periods[] so the coverage badge is truthful,
     e.g. today only Samsung/Micron carry periods → the rest read as not-migrated.)
     coverage DISTINGUISHES (plan §4.1): missing_periods (structural period shortfall
     for this lens, incl. not-migrated), missing_metric (structure present but a metric
     null), missing_ai_share; PLUS strict/proxy (CY) and implied-Q4 usage (CY/TTM).
     `complete` = structural coverage present for the mode AND net_income non-null (the
     pool headline). Returns { mode, label, complete, coverage, revenue, op_income,
     net_income, aiShare, aiWeightedNetIncome, warnings[] }. All null-safe. 算不存. */
  VIEW_METRICS: ["revenue", "op_income", "net_income"],
  VIEW_MODES: ["latestQuarter", "ttm", "calendarYear", "fiscalYear"],

  /* compact calendar tag of a period, e.g. "2026Q1" (identifier, not label parse) */
  _periodTag(p) {
    if (!p) return null;
    if (p.calendar_year != null && p.calendar_quarter) return "" + p.calendar_year + p.calendar_quarter;
    return p.period_end || p.period_id || null;
  },
  /* max string (lexical) ignoring null — FY labels sort correctly ("FY2025" < "FY2026") */
  _maxStr(arr) { let b = null; for (const x of arr) { if (x != null && (b == null || String(x) > String(b))) b = x; } return b; },
  /* default calendar year for CY lens = latest calendar year among actual quarter periods */
  _defaultCalYear(c) {
    const ys = this.actualPeriods(c).filter(p => p.kind === "quarter" && p.calendar_year != null).map(p => p.calendar_year);
    return ys.length ? Math.max(...ys) : null;
  },
  /* default fiscal year for FY lens = latest FY with an annual actual fact (official full
     year available), else latest FY among actual quarters. */
  _defaultFiscalYear(c) {
    const ap = this.actualPeriods(c);
    const annualFys = ap.filter(p => p.kind === "annual" && p.fiscal_year).map(p => p.fiscal_year);
    if (annualFys.length) return this._maxStr(annualFys);
    return this._maxStr(ap.filter(p => p.kind === "quarter" && p.fiscal_year).map(p => p.fiscal_year));
  },

  companyMetricView(c, mode, opts) {
    opts = opts || {};
    const out = {
      mode, label: null, complete: false,
      coverage: {
        source: "none",
        missing_periods: false,
        missing_quarters: [],
        missing_metric: [],
        missing_ai_share: false,
        strict: null,
        coverage_start: null,
        coverage_end: null,
        used_implied_q4: false,
        quarter_basis: null,
        gap: null,
        basis: null,
        as_of: null,
        reason: null,
      },
      revenue: null, op_income: null, net_income: null,
      aiShare: null, aiWeightedNetIncome: null,
      warnings: [],
    };
    if (!c) { out.coverage.missing_periods = true; out.coverage.reason = "no_company"; return out; }

    // AI share is company-level and period-independent → computed for every company (even
    // not-migrated) for transparency; aiWeightedNetIncome still needs a mode net income.
    const ai = this.aiShare(c);
    out.aiShare = ai.value;
    if (ai.value == null) { out.coverage.missing_ai_share = true; out.warnings.push("缺 AI 占比：不计入 AI 加权池"); }

    // GATE: only genuinely-migrated companies (real periods[]) get a period-base lens.
    const hasPeriods = Array.isArray(c.periods) && c.periods.length > 0;
    if (!hasPeriods) {
      out.coverage.missing_periods = true;
      out.coverage.reason = "not_migrated";
      out.warnings.push("该公司尚未迁入 periods（此镜头暂不适用，legacy years[] 口径见公司页）");
      return out;
    }
    out.coverage.source = "periods";

    const fill = () => {   // copy the derived metrics + flag per-metric gaps + set complete
      const miss = this.VIEW_METRICS.filter(m => out[m] == null);
      out.coverage.missing_metric = miss;
      out.complete = out.net_income != null;
      if (miss.length && !out.coverage.reason) out.coverage.reason = "missing_metric";
    };

    if (mode === "latestQuarter") {
      const q = this.latestQuarter(c);
      if (!q) {
        out.coverage.missing_periods = true;
        out.coverage.reason = "no_actual_quarter";
        out.warnings.push("无实际季度（仅有 guidance / 年度期）");
      } else {
        out.label = this._periodTag(q);
        out.coverage.as_of = q.period_end || null;
        for (const m of this.VIEW_METRICS) out[m] = q[m] != null ? q[m] : null;
        fill();
      }
    } else if (mode === "ttm") {
      // 镜头是 periods-pure 口径: 只走 ttmFromPeriods (无 legacy 回退)。
      const res = {};
      for (const m of this.VIEW_METRICS) res[m] = this.ttmFromPeriods(c, m);
      const ni = res.net_income;   // structural flags shared across the 3 metric windows
      out.label = "TTM";
      out.coverage.as_of = ni.asOf || null;
      out.coverage.used_implied_q4 = !!ni.usedImpliedQ4;
      out.coverage.quarter_basis = ni.basis || null;
      out.coverage.gap = ni.gap || null;
      if (!ni.contiguous) {
        out.coverage.missing_periods = true;
        out.coverage.reason = ni.gap ? "gap" : "insufficient_quarters";
        out.warnings.push(ni.gap ? ("TTM 不连续：" + ni.gap) : "TTM 季度不足四季（覆盖不足）");
      } else {
        for (const m of this.VIEW_METRICS) out[m] = res[m].value;
        fill();
        if (ni.usedImpliedQ4) out.warnings.push("TTM 含 implied Q4（财年末 = 年度事实 − 前三季）");
      }
    } else if (mode === "calendarYear") {
      const year = opts.year != null ? opts.year : this._defaultCalYear(c);
      const cy = this.calendarYear(c, year);
      out.label = cy.label;
      out.coverage.strict = cy.strict;
      out.coverage.coverage_start = cy.coverage_start;
      out.coverage.coverage_end = cy.coverage_end;
      out.coverage.used_implied_q4 = Object.values(cy.coverage || {}).includes("implied_q4");
      if (!cy.complete) {
        out.coverage.missing_periods = true;
        out.coverage.missing_quarters = cy.missing;
        out.coverage.reason = "missing_quarters";
        out.warnings.push("自然年不完整：缺 " + cy.missing.join("/"));
      } else {
        for (const m of this.VIEW_METRICS) out[m] = cy[m] != null ? cy[m] : null;
        fill();
        if (out.coverage.used_implied_q4) out.warnings.push("自然年 Q4 为 implied 派生（年度事实 − 前三财季）");
        if (!cy.strict) out.warnings.push("自然年为报告期近似（未严格覆盖 1-1~12-31）");
      }
    } else if (mode === "fiscalYear") {
      const fy = opts.fy != null ? opts.fy : this._defaultFiscalYear(c);
      const r = this.fiscalYearFromPeriods(c, fy);
      out.label = r.label != null ? r.label : (fy || "FY?");
      out.coverage.basis = r.basis;   // annual_report | quarter_sum
      if (!r.complete) {
        out.coverage.missing_periods = true;
        out.coverage.reason = r.basis === "quarter_sum" ? "insufficient_quarters" : "no_fiscal_year";
        out.warnings.push(r.basis === "quarter_sum"
          ? ("财年不完整：" + r.quarters + "/4 实际季")
          : "财年无年度事实");
      } else {
        for (const m of this.VIEW_METRICS) out[m] = r[m] != null ? r[m] : null;
        fill();
      }
    } else {
      out.coverage.reason = "unknown_mode";
      out.warnings.push("未知镜头：" + mode);
      return out;
    }

    out.aiWeightedNetIncome = (out.net_income != null && out.aiShare != null)
      ? out.net_income * out.aiShare : null;
    return out;
  },

  /* ---- TTM profit pool (value-chain stacked, self-rolled per company, AI-weighted) ----
     口径统一 (ADR-3): TTM 净利同样按 aiShare(c) 加权,与 profitPoolAI / profitPoolMigration
     的三根年度柱完全同口径 —— 同一张迁移图不再混"全额 TTM vs 加权年度"。
     Phase 6 final: TTM 净利走 ttmNetIncomeUnified(c) —— periods[] 口径 (含 implied Q4),
     无 legacy 回退。per-member 透传 basis, 返回 basisCount 供测试/审计确认口径构成。
       ni = ttmNetIncomeUnified(c).value × aiShare(c).value (公司级,用 latestActual 的 is_ai 代理)。
     Per-company null-safe & honest-gap: unified value 为 null 或 aiShare.value 为 null 的
     公司一律 DROP(绝不计 0、不 impute),与年度口径一致。total 仅累计加权后的贡献者。
     Reuses the same _aggregateStages atom as the annual migration so stage口径 cannot drift.
     asOfSpreadDays = max−min of contributing companies' latest-quarter dates — lets
     the view warn that the TTM cross-section is not perfectly date-aligned. */
  profitPoolTTM(companies) {
    const list = companies || [];
    const rows = [];
    const basisCount = { periods: 0 };
    let spreadMin = Infinity, spreadMax = -Infinity;
    for (const c of list) {
      const u = this.ttmNetIncomeUnified(c);            // final口径: periods > null
      if (u.value == null) continue;                    // honest gap: skip, never impute
      const share = this.aiShare(c).value;              // company-level, latestActual is_ai proxy
      if (share == null) continue;                      // no aiShare → drop (ADR-3, same as annual)
      basisCount[u.basis] = (basisCount[u.basis] || 0) + 1;
      const asOf = u.asOf;
      const t = this._parseDate(asOf);
      if (t != null) { if (t < spreadMin) spreadMin = t; if (t > spreadMax) spreadMax = t; }
      rows.push({ id: c.id, name: c.name, stage: stageOf(c), ni: u.value * share, asOf, aiShare: share, basis: u.basis });
    }
    const total = rows.reduce((s, r) => s + r.ni, 0);
    const stages = this._aggregateStages(rows, total).map(s => ({
      ...s,
      companies: s.companies.map(m => {
        const src = rows.find(r => r.id === m.id);
        return { id: m.id, name: m.name, ttm: m.ni, asOf: m.asOf, aiShare: src ? src.aiShare : null, basis: src ? src.basis : null };
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
      basisCount,   // {periods:n} — final口径构成 (legacy fallback 已退役)
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
     chronological (old→new). Year alignment uses year.period_end_iso only; legacy
     free-text period_end is display text, not a date source. Net may be negative (downcycle);
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

  /* extract a 4-digit year from a year record using machine-readable period_end_iso
     only (ADR-2). Free-text period_end is display text and must not drive UI logic. */
  _yearOf(y) {
    if (y && typeof y.period_end_iso === "string") {
      const mi = y.period_end_iso.match(/(\d{4})/);
      if (mi) return mi[1];
    }
    return null;
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
