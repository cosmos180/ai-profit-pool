<script>
  // 公司页（原 goCompany/renderCompany + renderCash）：KPI 卡 + 趋势 + 现金 + 估值 + 年份表。
  // 不存在的 companyId → 优雅"公司不存在"降级。业务数据全来自 Selectors，组件内无财务算术。
  import { nav } from '../lib/nav.svelte.js'
  import { Store, Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'
  import { Safe } from '../lib/safe.js'
  import Trend from '../charts/Trend.svelte'
  import ValuationCard from './ValuationCard.svelte'

  const c = $derived(nav.companyId ? Store.byId(nav.companyId) : null)

  const la = $derived(c ? Selectors.latestActual(c) : null)
  const fc = $derived(c ? Selectors.forecastYear(c) : null)

  // KPI 卡（原 renderCompany cards 逻辑）。fmt 已在此完成，val/sub 是格式化串。
  const kpis = $derived.by(() => {
    if (!c) return []
    const cards = la
      ? [
          { lbl: `${la.fy} 营收`, val: Fmt.bn(la.revenue), sub: '最新实际', cls: '', sw: 'var(--past)' },
          { lbl: `${la.fy} 净利润`, val: Fmt.bn(la.net_income), sub: '净利率 ' + Fmt.pct(Selectors.netMargin(la)), cls: 'accent', sw: 'var(--ok)' },
          { lbl: `${la.fy} 毛利率`, val: Fmt.pct(la.gross_margin), sub: 'GAAP', cls: 'accent', sw: 'var(--ok)' },
        ]
      : [{ lbl: '实际财年', val: '—', sub: '尚未补录 actual 年', cls: '', sw: 'var(--past)' }]
    if (fc) cards.push({ lbl: `${fc.fy} 营收`, val: '≈' + Fmt.bn(fc.revenue, 0), sub: '卖方一致预期', cls: 'est', sw: 'var(--est)' })
    return cards
  })

  // 年份表行（原 cYears map）。点击 → goDetail。ry/netMargin 来自 Selectors。
  const yearRows = $derived.by(() => {
    if (!c) return []
    return c.years.map(y => {
      const fcc = y.status === 'forecast'
      const ry = Selectors.revYoY(c, y.fy)
      return {
        fy: y.fy, fcc, ry,
        revLabel: (fcc ? '≈' : '') + Fmt.bn(y.revenue, fcc ? 0 : 1),
        niLabel: y.net_income != null ? (fcc ? '≈' : '') + Fmt.bn(y.net_income, fcc ? 0 : 1) : '—',
        nmLabel: Fmt.pct(Selectors.netMargin(y)),
      }
    })
  })

  // —— 现金块（原 renderCash）：用 latestCashYear 回退（非 latestActual）——
  const hasActual = $derived(c ? Selectors.actualYears(c).length > 0 : false)
  const cashYear = $derived(c ? Selectors.latestCashYear(c) : null)
  const cashCards = $derived.by(() => {
    const cy = cashYear
    if (!cy) return []
    const fcf = Selectors.fcf(cy)
    return [
      { lbl: 'capex 强度', val: Fmt.pct(Selectors.capexIntensity(cy)), sub: cy.capex != null ? 'capex ' + Fmt.bn(cy.capex, 1) + ' / 营收' : '未录入 capex', cls: '', sw: 'var(--est)' },
      { lbl: '自由现金流 FCF', val: Fmt.bn(fcf, 1), sub: cy.cfo != null ? 'CFO ' + Fmt.bn(cy.cfo, 1) + ' − capex' : '缺 CFO 无法派生', cls: fcf != null && fcf < 0 ? '' : 'accent', sw: 'var(--ok)' },
      { lbl: 'FCF 利润率', val: Fmt.pct(Selectors.fcfMargin(cy)), sub: 'FCF / 营收', cls: 'accent', sw: 'var(--ok)' },
      { lbl: '现金转化率', val: Fmt.pct(Selectors.cashConversion(cy)), sub: 'FCF / 净利润 · 利润含金量', cls: 'accent', sw: 'var(--ok)' },
    ]
  })
  const cashHeading = $derived(cashYear ? `质量与现金 · ${cashYear.fy}` : '质量与现金')

  // NVDA 特例 note。
  const note = $derived(
    c?.id === 'nvda'
      ? '本页"利润"均为公司层面 GAAP 净利润，可同口径逐年对比。FY2026 净利润 $120.1B 略高于经营利润 $130.4B 的税后水平，因当年含较大股权投资收益（GAAP 计入、非经营性）。下钻可见真实约束：营收拆 5 个平台，利润只披露到 2 个分部。'
      : '公司层面 GAAP / IFRS 净利润，按主要经营年度映射。'
  )
</script>

{#if !c}
  <h1 class="title">公司不存在</h1>
  <div class="note-block">
    未找到对应公司。
    <button class="crumb" style="margin-top:8px;color:var(--ok)" onclick={() => nav.goHome()}>← 返回公司对比</button>
  </div>
{:else}
  <h1 class="title">{c.name}</h1>
  <div class="cmeta-row">
    <span class="tickerbadge">{c.ticker}</span>
    <span class="tagx">{c.region}</span>
    <span class="tagx">{c.sector}</span>
    <span class="segtag {Safe.cls(c.seg_profit)}">{Fmt.segLabel(c.seg_profit)}</span>
  </div>
  {#if c.lead}<p class="lead">{c.lead}</p>{/if}

  <div class="section-h">公司层面 · 量级</div>
  <div class="kpis">
    {#each kpis as k}
      <div class="card kpi {Safe.cls(k.cls)}">
        <div class="k-lbl"><span class="swatch" style="background:{k.sw}"></span>{k.lbl}</div>
        <div class="k-val">{k.val}</div>
        <div class="k-sub">{k.sub}</div>
      </div>
    {/each}
  </div>

  <Trend company={c} />

  {#if hasActual}
    <div class="section-h">{cashHeading}</div>
    {#if !cashYear}
      <div class="note-block" style="margin-top:0"><b>现金流数据未录入。</b>本页"现金"指标需要 <code style="font-family:var(--mono)">capex</code> 与 <code style="font-family:var(--mono)">cfo</code>（经营现金流）两个原始字段——诚实做法是留空，而不是估一个数填进去。补录后此处自动出现 FCF、FCF 利润率、现金转化率与 capex 强度。</div>
    {:else}
      <div class="kpis">
        {#each cashCards as k}
          <div class="card kpi {Safe.cls(k.cls)}">
            <div class="k-lbl"><span class="swatch" style="background:{k.sw}"></span>{k.lbl}</div>
            <div class="k-val">{k.val}</div>
            <div class="k-sub">{k.sub}</div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <ValuationCard company={c} />

  <div class="section-h">按财年下钻 · 点击进入业务板块明细</div>
  <div class="years">
    {#each yearRows as y (y.fy)}
      <button class="ycard {y.fcc ? 'is-fc' : ''}" onclick={() => nav.goDetail(c.id, y.fy)}>
        <div class="yhead"><span class="yfy">{y.fy}</span><span class="ybadge {y.fcc ? 'fc' : 'act'}">{y.fcc ? '预测' : '实际'}</span></div>
        <div class="yrev num">{y.revLabel}</div>
        <div class="yrevlbl">营收{#if y.ry != null} · 同比 {Fmt.yoy(y.ry)}{/if}</div>
        <div class="yrow"><span class="l">净利润</span><span class="v num">{y.niLabel}</span></div>
        <div class="yrow"><span class="l">净利率</span><span class="v num">{y.nmLabel}</span></div>
        <span class="yopen">查看板块 →</span>
      </button>
    {/each}
  </div>

  <div class="note-block"><b>口径说明：</b>{note}</div>
{/if}
