<script>
  // Home（原 goHome/renderHome）：三卡 hero + poolNote + 迁移图 + 登记表 + 待补录。
  // 业务数据只从 lib/data.js 拿；组件内无财务算术（龙头占比/同比走 Selectors 派生）。
  import { nav } from '../lib/nav.svelte.js'
  import { Store, Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'
  import { Safe } from '../lib/safe.js'
  import { HOME_METRIC_LABEL, HOME_METRIC_FMT, HOME_METRIC_LOWER_CHEAPER } from '../lib/constants.js'
  import Migration from '../charts/Migration.svelte'

  const pop = $derived(Store.populated())
  const pend = $derived(Store.pending())

  // 三卡 hero：AI 利润池总额 / 利润最集中（龙头占比）/ 利润池同比（同源 pool 派生）。
  const lead = $derived(Selectors.profitPoolLeader(pop))
  const poolYoY = $derived(Selectors.profitPoolYoY(pop))
  const shortName = c => (c.name || '').split(' ')[0]

  // 诚实标注：当前 9 家 AI 占比全部为 is_ai 营收代理估算（proxy），非披露的 AI 利润占比。
  const basisAllProxy = $derived(lead.basisCount.sourced === 0 && lead.basisCount.proxy > 0)

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

  // 每行呈现数据（取值来自 Selectors，barW 是布局百分比非财务量）。
  const rows = $derived(ranked.map(c => {
    const la = Selectors.latestActual(c)
    const fc = Selectors.forecastYear(c)
    const ry = la ? Selectors.revYoY(c, la.fy) : null
    const val = Selectors.homeMetric(c, key)
    const barVal = val ?? 0   // 仅用于 bar 宽度渲染，非把 null 当业务值展示（数值列走 Fmt 渲 "—"）
    return {
      c, la, fc, ry, val,
      rel: relBadge(c),   // 估值倍数排序时的同环节相对角标（否则 null）
      barW: Math.max(0, Math.min(100, barVal / maxV * 100)).toFixed(1),
    }
  }))
</script>

<h1 class="title">公司对比</h1>
<p class="lead">数据已从界面剥离到 <code style="font-family:var(--mono)">companies.json</code>（受 <code style="font-family:var(--mono)">schema.json</code> 约束、由 <code style="font-family:var(--mono)">validate.py</code> 把关）。此页只负责<b>呈现与跳转</b>；一切派生（利润率、同比、对账）由数据访问层现算。</p>

<div class="section-h">覆盖情况</div>
<div class="cover">
  <div class="card cv accent">
    <div class="l"><span class="swatch" style="background:var(--ok)"></span>AI 利润池<span class="caliper">AI 归因加权</span></div>
    <div class="v num">{Fmt.bn(lead.pool, 0)}</div>
    <div class="plain">{lead.n} 家公司的净利润，按各自 AI 占比加权后相加</div>
    <div class="s">已按 AI 归因加权 · 覆盖 {lead.n}/{lead.N} 家</div>
  </div>
  <div class="card cv">
    <div class="l"><span class="swatch" style="background:var(--est)"></span>利润最集中</div>
    <div class="v num">{lead.share != null ? Fmt.pct(lead.share, 0) : '—'}</div>
    <div class="plain">{lead.leader ? `${shortName(lead.leader)} 一家占了全部 AI 利润的这么多` : '—'}</div>
    <div class="s">{lead.leader ? shortName(lead.leader) + ' 占 AI 加权池比重' : '—'}</div>
  </div>
  <div class="card cv accent">
    <div class="l"><span class="swatch" style="background:var(--past)"></span>利润池同比</div>
    <div class="v num">{poolYoY.value != null ? Fmt.yoy(poolYoY.value) : '—'}</div>
    <div class="plain">{poolYoY.value != null ? '整个 AI 利润池较上一财年的增速' : '—'}</div>
    <div class="s">{poolYoY.migLast && poolYoY.migPrev ? `AI 加权池 ${poolYoY.migPrev.label}→${poolYoY.migLast.label}` : 'AI 加权池较上一财年'}</div>
  </div>
</div>

<details class="cover-note">
  <summary><b>口径说明</b>：这三个数怎么算出来的<span class="cn-hint">展开 ⌄</span></summary>
  <p><b>AI 归因加权（C）。</b>利润池与下方迁移图均为「每家最新实际财年净利润 × 该公司 AI 占比」之和（{Fmt.bn(lead.pool, 0)}），而非全额净利润求和；缺 AI 占比的公司已诚实剔除，故覆盖 <b>{lead.n}/{lead.N}</b> 家。{#if basisAllProxy}当前 {lead.basisCount.proxy} 家的 AI 占比<b>全部为 <code>is_ai</code> 营收代理估算</b>（basis=proxy），<b>并非公司披露的 AI 利润占比</b>——把营收代理当作利润占比是一种近似，口径在此明示，请据此理解所有 AI 加权数值。{:else}AI 占比来源构成：<b>{lead.basisCount.sourced}</b> 家有据可依（sourced）、<b>{lead.basisCount.proxy}</b> 家为 <code>is_ai</code> 营收代理估算（proxy，非披露的 AI 利润占比，属近似）。{/if}</p>
</details>

<div class="section-h">利润池如何迁移</div>
<Migration />

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
      </div>
      <div class="cmetric">
        <div class="mv num">{HOME_METRIC_FMT[key](r.val)}{#if r.rel}<span class="relbadge {r.rel.cls}">{r.rel.txt}</span>{/if}</div>
        <div class="ms">最新实际 · {r.la ? (r.la.period_end || r.la.fy) : '无实际年'}{#if r.ry != null} · <span class={r.ry >= 0 ? 'up' : 'dn'}>{Fmt.yoy(r.ry)}</span>{/if}</div>
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
