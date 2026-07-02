<script>
  // 估值快照（原 renderValuation）：PE/PS/EV-Sales/FCF yield + caveat 三态。
  // caveat: 'na' → Selector 已返回 null，卡片留空并说明；'distorted' → 仍出值带警示；'ok' → 正常。
  // 无 quote → 整区诚实留空。业务数据全来自 Selectors，组件内无财务算术。
  import { Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'
  import { Safe } from '../lib/safe.js'
  import EvVsGrowth from '../charts/EvVsGrowth.svelte'

  let { company } = $props()

  const q = $derived(company?.quote || null)
  const la = $derived(Selectors.latestActual(company))
  const note = $derived(company?.valuation_caveat?.note || '')

  // EV/Sales 副行：净现金 / 净负债状态（解释 EV 与市值差在哪）——文案分流，非计算。
  const nd = $derived(Selectors.netDebt(company))
  const evSub2 = $derived.by(() => {
    if (nd == null) return '净负债未录入'
    if (nd < 0) return `净现金 ${Fmt.bn(-nd, 1)} · EV<市值`
    if (nd > 0) return `净负债 ${Fmt.bn(nd, 1)} · EV>市值`
    return '净负债 $0.0B · EV≈市值'
  })

  // 每个指标失真/不适用时的「一句最关键因由」（纯呈现文案，非计算）。
  // 完整口径说明不在卡内复制，收敛为卡组下方一条共享注释（诚实标注不丢，只是不物理复制）。
  const SHORT_REASON = {
    pe: '净利润含投资公允价值损益，非经营盈利',
    fcf_yield: '投资控股，FCF 不反映经营现金创造',
    ps: '营收主要来自电信子公司，非 AI 价值载体',
    ev_sales: '合并净负债含电信子公司债务 → EV 失真',
  }

  // relKey = stageValuationRel 的指标键(与 defs.key 的数据键名不同：ev_sales→evSales 等)。
  const defs = $derived([
    { key: 'pe', relKey: 'pe', lbl: 'PE 市盈率', val: Selectors.pe(company), fmt: Fmt.mult, denom: '市值 / 净利润', sw: 'var(--ok)' },
    { key: 'ps', relKey: 'ps', lbl: 'PS 市销率', val: Selectors.ps(company), fmt: Fmt.mult, denom: '市值 / 营收', sw: 'var(--ok)' },
    { key: 'ev_sales', relKey: 'evSales', lbl: 'EV/Sales', val: Selectors.evSales(company), fmt: Fmt.mult, denom: '(市值+净负债) / 营收', sub2: evSub2, sw: 'var(--ok)' },
    { key: 'fcf_yield', relKey: 'fcfYield', lbl: 'FCF yield', val: Selectors.fcfYield(company), fmt: Fmt.pct, denom: '自由现金流 / 市值', sw: 'var(--ok)' },
  ])

  // B1 同环节相对估值：每个指标从 Selector 取 {cohortN, median, relative, lowerCheaper, insufficient}，
  // 组件只做文案分流（无财务算术）。方向语义：lowerCheaper 决定「数值 low/high」对应「更便宜/更贵」。
  const relOf = d => {
    const r = Selectors.stageValuationRel(company, d.relKey)
    if (r.insufficient || r.relative == null) {
      return r.cohortN >= 1 ? '同环节样本不足' : ''
    }
    // relative ∈ low/mid/high 指数值高低；配合方向出「更便宜/更贵/接近中位」
    let tone = '接近中位'
    if (r.relative === 'low')  tone = r.lowerCheaper ? '偏低（更便宜）' : '偏低（更贵）'
    if (r.relative === 'high') tone = r.lowerCheaper ? '偏高（更贵）'   : '偏高（更便宜）'
    return `同环节 ${r.cohortN} 家 · 中位 ${d.fmt(r.median)} · ${tone}`
  }

  const cards = $derived(
    defs.map(d => ({ ...d, caveat: Selectors.valuationCaveat(company, d.key), rel: relOf(d), reason: SHORT_REASON[d.key] || '' }))
  )

  // 前瞻 PE(NTM · consensus)：独立于 trailing PE 呈现，视觉严格区分（蓝色 --ai 系）。
  // 口径 = price ÷ 一致预期 EPS（同币），来源 data_status=consensus；null → 诚实留空「待补」。
  const fwdPE = $derived(Selectors.forwardPE(company))
  const fwdYear = $derived(Selectors.forecastYear(company))
  // 是否存在任一失真/不适用的指标 → 才展示卡组下方那条共享口径说明（完整 note）。
  const hasCaveat = $derived(!!note && cards.some(d => d.caveat === 'na' || d.caveat === 'distorted'))

  // quote 来源行（复用来源展示范式，derived=汇率换算）。
  const srcRows = $derived((q?.sources || []).map(s => ({
    label: s.label,
    status: s.data_status || '',
    derived: (s.data_status || '') === 'derived',
    url: Safe.url(s.url),
  })))
</script>

<div class="section-h">估值快照</div>
{#if !q}
  <div class="note-block" style="margin-top:0"><b>未录入市场快照。</b>PE / PS / FCF yield 需要 <code style="font-family:var(--mono)">quote.market_cap</code>（市值）与最新实际财年业绩。诚实做法是留空，补录后此处自动出现三项倍数与来源。</div>
{:else}
  <div class="val-head">
    <span>市场快照 · <span class="asof">{q.as_of || '—'}</span></span>
    <span class="mismatch">口径错位：<b>价格截至快照日</b>，倍数分母用<b>最新实际财年</b>{la ? ` ${la.fy} 业绩` : '业绩'}（两者时点不同，属正常）</span>
  </div>
  <div class="kpis">
    {#each cards as d (d.key)}
      {#if d.caveat === 'na'}
        <div class="card kpi empty">
          <div class="k-lbl"><span class="swatch" style="background:var(--past)"></span>{d.lbl}<span class="k-flag na">不适用</span></div>
          <div class="k-val num">—</div>
          <div class="k-note muted">{d.reason || '该指标对此公司无经营含义，诚实留空。'}</div>
        </div>
      {:else if d.caveat === 'distorted'}
        <div class="card kpi distort">
          <div class="k-lbl"><span class="swatch" style="background:var(--est)"></span>{d.lbl}<span class="k-flag distort">口径失真</span></div>
          <div class="k-val num">{d.fmt(d.val)}</div>
          <div class="k-sub">{d.denom}</div>
          {#if d.sub2}<div class="k-sub">{d.sub2}</div>{/if}
          <div class="k-note">{d.reason || '该倍数受口径影响，仅供参考。'}</div>
        </div>
      {:else}
        <div class="card kpi accent">
          <div class="k-lbl"><span class="swatch" style="background:{d.sw}"></span>{d.lbl}</div>
          <div class="k-val num">{d.fmt(d.val)}</div>
          <div class="k-sub">{d.denom}</div>
          {#if d.sub2}<div class="k-sub">{d.sub2}</div>{/if}
          {#if d.rel}<div class="k-rel">{d.rel}</div>{/if}
        </div>
      {/if}
    {/each}
  </div>

  <div class="fwd-pe card" class:empty={fwdPE == null}>
    <div class="fwd-lbl">
      <span class="swatch" style="background:var(--ai)"></span>前瞻 PE
      <span class="fwd-tag">NTM · 一致预期</span>
    </div>
    <div class="fwd-body">
      <div class="fwd-val num">{Fmt.mult(fwdPE)}</div>
      <div class="fwd-sub">
        {#if fwdPE != null}
          价格 / 一致预期 EPS{fwdYear ? `（${fwdYear.fy}）` : ''} · 来源 <b>consensus</b>，非官方 trailing
        {:else}
          待补一致预期 EPS（<code style="font-family:var(--mono)">consensus_eps_value</code>）—— 数据到位后自动点亮，与上方 trailing PE 分列
        {/if}
      </div>
    </div>
  </div>

  {#if hasCaveat}
    <details class="caveat-note">
      <summary>为何部分估值指标留空或降级？<span class="cn-hint">口径说明 ⌄</span></summary>
      <p>{note}</p>
    </details>
  {/if}

  <EvVsGrowth {company} caveatShown={hasCaveat} />

  <div class="section-h" style="margin-top:20px">市场快照来源</div>
  <div class="card srcs">
    {#if srcRows.length}
      {#each srcRows as s}
        <div class="srcrow"><span class="sl">{s.label}<span class="tagx" style="margin-left:8px">{s.status}{s.derived ? ' · 汇率换算' : ''}</span></span><a href={s.url} target="_blank" rel="noopener">来源 ↗</a></div>
      {/each}
    {:else}
      <div class="srcrow"><span class="sl">未列出来源</span></div>
    {/if}
  </div>
{/if}

<style>
  /* 前瞻 PE：蓝色 --ai 系，与 trailing PE(绿 --ok) 视觉严格区分；不与官方 trailing 混淆。
     复用全局 .card / .num；此处只加区隔性配色与横向排布，不新造花哨样式。 */
  .fwd-pe {
    margin-top: 14px;
    padding: 14px 17px;
    border-left: 4px solid var(--ai);
    background: linear-gradient(0deg, var(--ai-soft), var(--card));
  }
  .fwd-pe.empty {
    background: var(--card-2);
    border-left-color: var(--line);
  }
  .fwd-lbl {
    font-size: 12px;
    color: var(--ink-soft);
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .fwd-tag {
    font-family: var(--mono);
    font-size: 9.5px;
    padding: 2px 7px;
    border-radius: 5px;
    text-transform: uppercase;
    letter-spacing: .05em;
    background: var(--ai-soft);
    color: var(--ai);
    margin-left: 6px;
  }
  .fwd-pe.empty .fwd-tag {
    background: var(--card);
    color: var(--ink-faint);
    border: 1px solid var(--line);
  }
  .fwd-body {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-top: 7px;
    flex-wrap: wrap;
  }
  .fwd-val {
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -.01em;
    color: var(--ai);
  }
  .fwd-pe.empty .fwd-val {
    color: var(--ink-faint);
  }
  .fwd-sub {
    font-size: 11.5px;
    color: var(--ink-faint);
    line-height: 1.45;
    flex: 1 1 200px;
  }
</style>
