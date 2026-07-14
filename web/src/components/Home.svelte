<script>
  // Home（原 goHome/renderHome）：报告镜头 + 登记表 + 待补录；高级分析另页承载。
  // 业务数据只从 lib/data.js 拿；组件内无财务算术（龙头占比/同比走 Selectors 派生）。
  import { nav } from '../lib/nav.svelte.js'
  import { Store, Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'
  import { Safe } from '../lib/safe.js'
  import { HOME_METRIC_LABEL, HOME_METRIC_FMT, HOME_METRIC_LOWER_CHEAPER } from '../lib/constants.js'

  const pop = $derived(Store.populated())
  const pend = $derived(Store.pending())

  const shortName = c => (c.name || '').split(' ')[0]

  // homeMetric 排序 + bar 宽（Selectors.homeMetric 取值，排序/取 max 非财务算术）。
  const key = $derived(nav.homeMetric)
  const ranked = $derived(
    pop.slice().sort((a, b) => (Selectors.homeMetric(b, key) ?? -Infinity) - (Selectors.homeMetric(a, key) ?? -Infinity))
  )
  const maxV = $derived(Math.max(...ranked.map(c => Selectors.homeMetric(c, key) ?? 0), 0.0001))

  const chips = [
    { m: 'revenue', label: '营收' }, { m: 'netIncome', label: '净利润' },
    { m: 'netM', label: '净利率' }, { m: 'fcfMargin', label: 'FCF 利润率' },
    { m: 'capexInt', label: 'capex 强度' },
  ]
  const valChips = [
    { m: 'pe', label: 'PE' }, { m: 'ps', label: 'PS' },
    { m: 'evSales', label: 'EV/Sales' }, { m: 'fcfYield', label: 'FCF yield' },
  ]
  // 估值倍数指标集合（valChips 的 m 恰是 stageValuationRel 的 key）——仅这些指标显同环节相对角标。
  const isValKey = $derived(valChips.some(ch => ch.m === key))

  // 同环节相对位置角标文案（纯呈现文案，方向语义据 lowerCheaper 分流，无计算）。
  const relBadge = c => {
    if (!isValKey) return null
    const r = Selectors.stageValuationRel(c, key)
    if (r.insufficient || r.relative == null) return null   // na/distorted/样本不足/独家 → 不加角标
    if (r.relative === 'mid') return { txt: '同环节居中', cls: 'mid' }
    if (r.relative === 'low') return r.lowerCheaper ? { txt: '同环节偏低', cls: 'low' } : { txt: '同环节偏低', cls: 'high' }
    return r.lowerCheaper ? { txt: '同环节偏高', cls: 'high' } : { txt: '同环节偏高', cls: 'low' }
  }

  // metric-hint 文案（纯呈现文案，无计算）。
  const hint = $derived.by(() => {
    if (key === 'evSales') return { show: true, kind: 'evSales' }
    if (HOME_METRIC_LOWER_CHEAPER[key]) return { show: true, kind: 'lower' }
    if (key === 'fcfYield') return { show: true, kind: 'fcfYield' }
    return { show: false }
  })

  // ---- 报告镜头（口径，非指标）：只作用于登记表下方的「按镜头」数值/角标区 ----
  // 迁移图 / AI 池 hero / 估值卡仍走 years[] 口径（Phase 5 全量迁完才切；本轮克制不动）。
  const lensModes = [
    { k: 'latestQuarter', label: '最新季' }, { k: 'ttm', label: 'TTM' },
    { k: 'calendarYear', label: '自然年' }, { k: 'fiscalYear', label: '财年' },
  ]
  const lensLabel = { latestQuarter: '最新季', ttm: 'TTM', calendarYear: '自然年', fiscalYear: '财年' }
  const AUTO_LENS = 'latestQuarter' // 默认看最新已发布季度，让 2026Q1/Q2 第一眼可见
  const autoLens = $derived(AUTO_LENS)
  const effLens = $derived(nav.reportLens === 'auto' ? autoLens : nav.reportLens)

  const qTag = q => q?.calendar_year != null && q?.calendar_quarter ? `${q.calendar_year}${q.calendar_quarter}` : null
  const latestReportCoverage = $derived.by(() => {
    const latest = pop.map(c => ({ c, q: Selectors.latestQuarter(c) })).filter(x => x.q)
    const actualByTag = new Map()
    for (const item of latest) {
      const tag = qTag(item.q)
      if (!tag) continue
      if (!actualByTag.has(tag)) actualByTag.set(tag, [])
      actualByTag.get(tag).push(item.c)
    }
    const actual = [...actualByTag.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([tag, companies]) => ({ tag, n: companies.length, names: companies.map(x => shortName(x)).join(' / ') }))

    const guidanceByTag = new Map()
    for (const c of pop) {
      const qs = Selectors.periods(c).filter(p => p.kind === 'quarter' && p.status === 'guidance')
      for (const q of qs) {
        const tag = qTag(q)
        if (!tag) continue
        if (!guidanceByTag.has(tag)) guidanceByTag.set(tag, [])
        guidanceByTag.get(tag).push(c)
      }
    }
    const guidance = [...guidanceByTag.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([tag, companies]) => ({ tag, n: companies.length, names: companies.map(x => shortName(x)).join(' / ') }))

    return { actualN: latest.length, actual, guidance }
  })

  // 镜头 coverage 文案（纯呈现：把 coverage.reason/标记翻成人话）。
  const METRIC_CN = { revenue: '营收', op_income: '经营利润', net_income: '净利' }
  const lensReason = v => {
    const r = v.coverage.reason
    if (r === 'not_migrated') return '尚未迁入 periods'
    if (r === 'missing_quarters') return '缺 ' + v.coverage.missing_quarters.join('/')
    if (r === 'gap') return 'TTM 缺季（不连续）'
    if (r === 'insufficient_quarters') return v.mode === 'ttm' ? '季度不足四季' : '季度不足'
    if (r === 'no_actual_quarter') return '无实际季度'
    if (r === 'no_fiscal_year') return '无年度事实'
    return null
  }
  // 完整行的角标（Q4 implied / 自然年近似 / 缺某指标）——纯呈现。
  const lensBadges = v => {
    const b = []
    if (v.coverage.used_implied_q4) b.push({ txt: 'Q4 implied', cls: 'impl', tip: '该季 Q4 由「年度事实 − 前三财季」派生（implied Q4）' })
    if (v.mode === 'calendarYear' && v.coverage.strict === false) b.push({ txt: '自然年近似', cls: 'proxy', tip: '四季未严格拼满 1/1~12/31，为报告期近似（strict=false）' })
    if (v.mode === 'fiscalYear' && v.coverage.basis === 'annual_report') b.push({ txt: '年度事实', cls: 'ok', tip: '来自 kind=annual 官方全年事实（优于季度求和）' })
    for (const m of v.coverage.missing_metric) b.push({ txt: '缺' + METRIC_CN[m], cls: 'miss', tip: m + ' 在该口径下缺失，诚实留空' })
    return b
  }

  // 每行呈现数据（取值来自 Selectors，barW 是布局百分比非财务量）。
  const rows = $derived(ranked.map(c => {
    const la = Selectors.latestActual(c)
    const annual = Selectors.latestActualAnnual(c)
    const fc = Selectors.forecastYear(c)
    const ry = annual ? Selectors.annualRevYoY(c, annual.fiscal_year) : null
    const val = Selectors.homeMetric(c, key)
    const barVal = val ?? 0   // 仅用于 bar 宽度渲染，非把 null 当业务值展示（数值列走 Fmt 渲 "—"）
    const view = Selectors.companyMetricView(c, effLens)   // 当前镜头的视图模型（口径）
    return {
      c, la, fc, ry, val, view,
      reason: lensReason(view),
      badges: lensBadges(view),
      rel: relBadge(c),   // 估值倍数排序时的同环节相对角标（否则 null）
      barW: Math.max(0, Math.min(100, barVal / maxV * 100)).toFixed(1),
    }
  }))
  const lensDone = $derived(rows.filter(r => r.view.complete).length)
</script>

<h1 class="title">公司对比</h1>
<p class="lead">数据已从界面剥离到 <code style="font-family:var(--mono)">companies.json</code>（受 <code style="font-family:var(--mono)">schema.json</code> 约束、由 <code style="font-family:var(--mono)">validate.py</code> 把关）。此页只负责<b>呈现与跳转</b>；一切派生（利润率、同比、对账）由数据访问层现算。</p>

<div class="lens-bar" role="group" aria-label="报告镜头">
  <div class="lens-head">
    <span class="lens-eyebrow">报告镜头</span>
    <span class="lens-cur">{lensLabel[effLens]}</span>
    <span class="lens-badge" title="按当前镜头，口径完整（含净利）的公司数 / 已补录公司数">{lensDone}/{pop.length} 完整</span>
    {#if nav.reportLens === 'auto'}<span class="lens-auto">自动</span>{/if}
  </div>
  <div class="lens-modes">
    {#each lensModes as m (m.k)}
      <button class="lensbtn" aria-pressed={effLens === m.k} onclick={() => nav.setReportLens(m.k)}>{m.label}</button>
    {/each}
    {#if nav.reportLens !== 'auto'}
      <button class="lensbtn reset" onclick={() => nav.setReportLens('auto')} title="恢复按覆盖度自动选镜头">↺ 自动</button>
    {/if}
  </div>
  <div class="latest-strip" aria-label="最新财报覆盖">
    <span class="latest-label">最新财报</span>
    <span class="latest-total">{latestReportCoverage.actualN}/{pop.length} 家有实际季度</span>
    {#each latestReportCoverage.actual as item (item.tag)}
      <span class="latest-chip" title={item.names}>{item.tag} · {item.n} 家</span>
    {/each}
    {#each latestReportCoverage.guidance as item (item.tag)}
      <span class="latest-chip guide" title={item.names}>{item.tag} guidance · {item.n} 家</span>
    {/each}
  </div>
  <div class="lens-note">
    默认展示<b>最新季</b>，用于看 2026 年已发布财报；TTM 仍适合横向比较利润池，自然年 2026 在 Q1-Q4 未齐前会诚实显示缺季。此镜头只作用于<b>下方登记表</b>的「按镜头」数值/角标区；迁移图、AI 利润池、估值卡仍走年度（years[]）口径。
  </div>
</div>

<div class="analysis-entry">
  <div>
    <div class="ae-k">高级分析</div>
    <div class="ae-t">AI 归因、利润池迁移、结构判断</div>
  </div>
  <button class="ae-btn" onclick={() => nav.goAnalysis()}>利润池迁移 →</button>
</div>

<div class="section-h">已补录公司 <span class="count">{pop.length} 家</span></div>
<div class="metricbar">
  <span class="ml">对比指标</span>
  {#each chips as ch (ch.m)}
    <button class="chip" aria-pressed={key === ch.m} onclick={() => nav.setHomeMetric(ch.m)}>{ch.label}</button>
  {/each}
  <span class="ml" style="margin-left:6px">估值</span>
  {#each valChips as ch (ch.m)}
    <button class="chip" aria-pressed={key === ch.m} onclick={() => nav.setHomeMetric(ch.m)}>{ch.label}</button>
  {/each}
</div>

{#if hint.show}
  <div class="metric-hint">
    {#if hint.kind === 'evSales'}
      <b>EV/Sales 越低越便宜</b>，分子 EV=市值+净负债（净现金公司 EV&lt;市值，故可低于 PS）。列表仍按数值降序（大在上），<b>排在最上的是估值最贵的，不是最便宜的</b>。分母用各公司最新实际财年营收，市值/净负债截至快照日；软银合并口径含电信子公司债务，<b>EV/Sales 失真</b>，详见公司页"估值快照"。
    {:else if hint.kind === 'lower'}
      <b>{HOME_METRIC_LABEL[key]} 越低越便宜。</b>列表仍按数值降序（大在上），所以<b>排在最上的是估值最贵的，不是最便宜的</b>。倍数分母用各公司最新实际财年业绩，市值截至快照日，详见公司页"估值快照"。
    {:else}
      <b>FCF yield 越高越便宜</b>（自由现金流 / 市值），与 PE/PS 方向相反。投资控股类公司（如软银）此项无经营含义，已诚实留空。
    {/if}
  </div>
{/if}

<div class="dir">
  {#each rows as r (r.c.id)}
    <button class="crow" onclick={() => nav.goCompany(r.c.id)}>
      <div class="logo {Safe.cls(r.c.logo_class)}"><span>{r.c.logo_text || r.c.name.slice(0, 2)}</span></div>
      <div class="cinfo">
        <div class="cn">{r.c.name}</div>
        <div class="cmeta">
          <span class="tagx">{r.c.region}</span>
          <span class="tagx">{r.c.sector}</span>
          <span class="segtag {Safe.cls(r.c.seg_profit)}">{Fmt.segLabel(r.c.seg_profit)}</span>
        </div>
        <div class="lensval {r.view.complete ? '' : 'muted'}">
          {#if r.view.complete}
            <span class="lv-num num">{Fmt.bn(r.view.net_income, 1)}</span>
            <span class="lv-lab">净利 · {lensLabel[effLens]}{#if r.view.label} {r.view.label}{/if}</span>
            {#each r.badges as b}<span class="lv-badge {b.cls}" title={b.tip}>{b.txt}</span>{/each}
          {:else}
            <span class="lv-num muted">—</span>
            <span class="lv-lab">{lensLabel[effLens]}</span>
            {#if r.reason}<span class="lv-badge miss" title="该镜头下此口径不可得，诚实留空（不伪造）">{r.reason}</span>{/if}
          {/if}
        </div>
      </div>
      <div class="cmetric">
        {#if r.view.complete}
          <div class="mv num">{Fmt.bn(r.view.revenue, 1)}</div>
          <div class="ms primary">营收 · {lensLabel[effLens]}{#if r.view.label} {r.view.label}{/if}</div>
          <div class="ms">净利 {Fmt.bn(r.view.net_income, 1)} · 年度{HOME_METRIC_LABEL[key]} {HOME_METRIC_FMT[key](r.val)}</div>
        {:else}
          <div class="mv num">{HOME_METRIC_FMT[key](r.val)}{#if r.rel}<span class="relbadge {r.rel.cls}">{r.rel.txt}</span>{/if}</div>
          <div class="ms">最新实际 · {r.la ? (r.la.period_end || r.la.fy) : '无实际年'}{#if r.ry != null} · <span class={r.ry >= 0 ? 'up' : 'dn'}>{Fmt.yoy(r.ry)}</span>{/if}</div>
        {/if}
      </div>
      <div class="cbarcell">
        <div class="cbar"><div class="f" style="width:{r.barW}%"></div></div>
        {#if r.fc}<div class="cfore">{r.fc.fy} 预测 ≈ {Fmt.bn(r.fc.revenue, 0)}</div>{/if}
        <div class="copen">查看 →</div>
      </div>
    </button>
  {/each}
</div>

<div class="section-h">预留槽位 · 待补录 <span class="count">{pend.length} 家</span></div>
<div class="dir">
  {#each pend as c (c.id)}
    <div class="prow">
      <div class="logo"><span>{c.logo_text || c.name.slice(0, 2)}</span></div>
      <div class="cinfo">
        <div class="cn">{c.name}</div>
        <div class="cmeta">
          <span class="tagx">{c.region}</span>
          <span class="tagx">{c.sector}</span>
          <span class="segtag {Safe.cls(c.seg_profit)}">{Fmt.segLabel(c.seg_profit)}</span>
          <span class="pendbadge">待补录</span>
        </div>
      </div>
      <div class="psrc">计划来源：{c.planned_source || '—'}</div>
    </div>
  {/each}
</div>

<div class="addhint">
  <b>扩展方式：</b>补录一家公司 = 给它的 <code>years[]</code> 填入各财年对象，跑一遍 <code>validate.py</code>，主页与下钻无需改动。槽位上的 <span class="segtag yes" style="display:inline">可得</span>/<span class="segtag partial" style="display:inline">部分</span>/<span class="segtag no" style="display:inline">不可得</span> 已预判补录后下钻能做到什么：可得的公司（三星、博通）下钻会自动出现真实分部利润与利润率，不可得的（台积电、ASML）会显式留空。
</div>
