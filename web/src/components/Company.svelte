<script>
  // 公司页（原 goCompany/renderCompany + renderCash）：KPI 卡 + 趋势 + 现金 + 估值 + 年份表。
  // 不存在的 companyId → 优雅"公司不存在"降级。业务数据全来自 Selectors，组件内无财务算术。
  import { nav } from '../lib/nav.svelte.js'
  import { Store, Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'
  import { Safe } from '../lib/safe.js'
  import { ccy, money } from '../lib/ccy.svelte.js'
  import Trend from '../charts/Trend.svelte'
  import ValuationCard from './ValuationCard.svelte'
  import SourcesBlock from './SourcesBlock.svelte'

  const c = $derived(nav.companyId ? Store.byId(nav.companyId) : null)

  const la = $derived(c ? Selectors.latestActualAnnual(c) : null)
  const fc = $derived(c ? Selectors.forecastYear(c) : null)
  const latestPeriod = $derived(c ? Selectors.latestQuarter(c) : null)
  const latestView = $derived(c ? Selectors.companyMetricView(c, 'latestQuarter') : null)
  const metricCn = { revenue: '营收', op_income: '经营利润', net_income: '净利' }
  const missingMetricText = $derived(
    latestView?.coverage?.missing_metric?.map(m => metricCn[m] || m).join(' / ') || ''
  )
  const latestReportCards = $derived.by(() => {
    if (!latestView?.complete) return []
    const cards = [
      { lbl: '营收', val: money(latestView.revenue, latestPeriod, 1), sub: `${latestView.label} · 截至 ${latestView.coverage.as_of}`, cls: '', sw: 'var(--past)' },
      { lbl: '净利润', val: money(latestView.net_income, latestPeriod, 1), sub: '最新实际季度', cls: 'accent', sw: 'var(--ok)' },
    ]
    if (latestView.op_income != null) cards.push({ lbl: '经营利润', val: money(latestView.op_income, latestPeriod, 1), sub: '公司层面', cls: 'accent', sw: 'var(--ok)' })
    if (latestPeriod?.gross_profit != null) cards.push({ lbl: '毛利', val: money(latestPeriod.gross_profit, latestPeriod, 1), sub: '公司层面', cls: 'accent', sw: 'var(--ok)' })
    return cards
  })
  const periodTag = p => p?.calendar_year != null && p?.calendar_quarter ? `${p.calendar_year}${p.calendar_quarter}` : (p?.period_end || p?.period_id || '—')

  // —— 显示币种：口径收敛在 lib/ccy（结构化入口，见该模块注释）。此处只保留
  // 切换可见性（srcCcyOf=null 的 USD 报表公司不渲染切换）与会话状态读写。金额调用点
  // 直接 import 的 money(v, carrier, d)——carrier 是该金额的数据期。 ——
  const srcCcy = $derived(c ? Selectors.srcCcyOf(c) : null)
  const inSrc = $derived(ccy.mode === 'src' && !!srcCcy)
  // Trend 的 localize（数值版）：按 FY 映射年度期 fx；预测年无期 → 用最新已知年汇率兜底
  // （图中标注「预测年按最新年汇率折算」，绝不显示错量级的 USD 裸值）。
  const fxByFy = $derived.by(() => {
    if (!c) return {}
    const m = {}
    for (const p of Selectors.actualAnnuals(c)) {
      if (p.fiscal_year && p.fx_to_usd && p.currency === srcCcy) m[p.fiscal_year] = p.fx_to_usd
    }
    return m
  })
  const trendLocalize = $derived.by(() => {
    if (!inSrc) return null
    const fxs = Object.values(fxByFy)
    const latest = fxs.length ? fxs[fxs.length - 1] : null
    return (v, fy) => {
      const fx = fxByFy[fy] != null ? fxByFy[fy] : latest
      return fx != null && v != null ? v * fx : null
    }
  })

  // KPI 卡（原 renderCompany cards 逻辑）。fmt 已在此完成，val/sub 是格式化串。
  const kpis = $derived.by(() => {
    if (!c) return []
    return la
      ? [
          { lbl: `${la.fiscal_year} 营收`, val: money(la.revenue, la, 1), sub: '最新实际', cls: '', sw: 'var(--past)' },
          { lbl: `${la.fiscal_year} 净利润`, val: money(la.net_income, la, 1), sub: '净利率 ' + Fmt.pct(Selectors.netMargin(la)), cls: 'accent', sw: 'var(--ok)' },
          { lbl: `${la.fiscal_year} 毛利率`, val: Fmt.pct(Selectors.grossMargin(la)), sub: 'GAAP', cls: 'accent', sw: 'var(--ok)' },
        ]
      : [{ lbl: '实际财年', val: '—', sub: '尚未补录 actual 年', cls: '', sw: 'var(--past)' }]
  })

  const quarterRows = $derived.by(() => {
    if (!c) return []
    return Selectors.periods(c)
      .filter(p => p.kind === 'quarter' && p.status === 'actual')
      .slice()
      .sort((a, b) => (b.period_end || '').localeCompare(a.period_end || ''))
      .map(p => ({
        id: p.period_id || p.period_end,
        periodId: p.period_id,
        tag: periodTag(p),
        end: p.period_end,
        rev: p.revenue,
        ni: p.net_income,
        revLabel: money(p.revenue, p, 1),
        niLabel: money(p.net_income, p, 1),
        nmLabel: Fmt.pct(Selectors.netMargin(p)),
      }))
  })

  // 年份表行（原 cYears map）。点击 → goDetail。ry/netMargin 来自 Selectors。
  const yearRows = $derived.by(() => {
    if (!c) return []
    return Selectors.actualAnnuals(c).map(y => {
      // src 模式下同比按原币还原（真实经营增速，去汇率折算噪声）；USD 模式保持库内口径。
      const ry = inSrc ? Selectors.annualRevYoYSrc(c, y.fiscal_year) : Selectors.annualRevYoY(c, y.fiscal_year)
      return {
        fy: y.fiscal_year, ry,
        revLabel: money(y.revenue, y, 1),
        niLabel: y.net_income != null ? money(y.net_income, y, 1) : '—',
        nmLabel: Fmt.pct(Selectors.netMargin(y)),
      }
    })
  })
  const forecastRows = $derived.by(() => {
    if (!c) return []
    return c.years.filter(y => y.status === 'forecast').map(y => ({
      fy: y.fy,
      // 预测年是 years[] 侧事实，无原币载体 → 恒按 USD 呈现（子标注明），不拿错期汇率硬折。
      revLabel: '≈' + Fmt.bn(y.revenue, 0),
      niLabel: y.net_income != null ? '≈' + Fmt.bn(y.net_income, 0) : '—',
      nmLabel: Fmt.pct(Selectors.netMargin(y)),
    }))
  })

  // —— 现金块：periods 侧现金年阶梯（非 headline 最新年）——
  const hasActual = $derived(c ? Selectors.actualAnnuals(c).length > 0 : false)
  const cashYear = $derived(c ? Selectors.latestCashActualAnnual(c) : null)
  const cashCards = $derived.by(() => {
    const cy = cashYear
    if (!cy) return []
    const fcf = Selectors.fcf(cy)
    return [
      { lbl: 'capex 强度', val: Fmt.pct(Selectors.capexIntensity(cy)), sub: cy.capex != null ? 'capex ' + money(cy.capex, cy, 1) + ' / 营收' : '未录入 capex', cls: '', sw: 'var(--est)' },
      { lbl: '自由现金流 FCF', val: money(fcf, cy, 1), sub: cy.cfo != null ? 'CFO ' + money(cy.cfo, cy, 1) + ' − capex' : '缺 CFO 无法派生', cls: fcf != null && fcf < 0 ? '' : 'accent', sw: 'var(--ok)' },
      { lbl: 'FCF 利润率', val: Fmt.pct(Selectors.fcfMargin(cy)), sub: 'FCF / 营收', cls: 'accent', sw: 'var(--ok)' },
      { lbl: '现金转化率', val: Fmt.pct(Selectors.cashConversion(cy)), sub: 'FCF / 净利润 · 利润含金量', cls: 'accent', sw: 'var(--ok)' },
    ]
  })
  const cashHeading = $derived(cashYear ? `质量与现金 · ${cashYear.fiscal_year}` : '质量与现金')

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
  {#if srcCcy}
    <div class="ccy-toggle" role="group" aria-label="显示币种">
      <span class="ct-lbl">显示币种</span>
      <button class="ct-chip" class:on={ccy.mode !== 'src'} onclick={() => ccy.set('usd')}
        title="库内统一 USD 口径（按各期入账汇率折算），跨公司可比">USD</button>
      <button class="ct-chip" class:on={ccy.mode === 'src'} onclick={() => ccy.set('src')}
        title="{srcCcy} 报告币种：按各期财报原币精确还原（该期入账汇率 ×），与官方 filing 逐位一致；同比亦按原币计算（去汇率影响）。预测年与估值卡仍为 USD。">{srcCcy} 报告币种</button>
    </div>
  {/if}
  {#if c.lead}<p class="lead">{c.lead}</p>{/if}

  <div class="section-h">最新报告期{#if latestView?.label} · {latestView.label}{/if}</div>
  {#if latestReportCards.length}
    <div class="kpis">
      {#each latestReportCards as k}
        <div class="card kpi {Safe.cls(k.cls)}">
          <div class="k-lbl"><span class="swatch" style="background:{k.sw}"></span>{k.lbl}</div>
          <div class="k-val">{k.val}</div>
          <div class="k-sub">{k.sub}</div>
        </div>
      {/each}
    </div>
    {#if missingMetricText}
      <div class="note-block"><b>季度口径说明：</b>{latestView.label} 已录入实际季度营收与净利；{missingMetricText} 未在当前季度原子中录入，诚实留空。</div>
    {/if}
    <SourcesBlock year={latestPeriod} />
  {:else}
    <div class="note-block" style="margin-top:0"><b>暂无实际季度原子。</b>该公司目前只能看下方年度事实或预测年。</div>
  {/if}

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

  <Trend company={c} localize={trendLocalize} ccy={inSrc ? srcCcy : 'USD'} />

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

  {#if quarterRows.length}
    <div class="section-h">季度事实 · 实际报告期</div>
    <div class="years">
      {#each quarterRows as q (q.id)}
        <button class="ycard qcard" onclick={() => nav.goPeriod(c.id, q.periodId)} disabled={!q.periodId}>
          <div class="yhead"><span class="yfy">{q.tag}</span><span class="ybadge act">实际</span></div>
          {#if q.rev != null}
            <div class="yrev num">{q.revLabel}</div>
            <div class="yrevlbl">营收 · 截至 {q.end}</div>
            <div class="yrow"><span class="l">净利润</span><span class="v num">{q.niLabel}</span></div>
            <div class="yrow"><span class="l">净利率</span><span class="v num">{q.nmLabel}</span></div>
          {:else if q.ni != null}
            <!-- 仅净利补录的季度原子（营收未录）：主数值切到净利润并显式声明，避免「主值空/副值有」的矛盾观感；净利率依赖营收，不渲染空行 -->
            <div class="yrev num">{q.niLabel}</div>
            <div class="yrevlbl">净利润 · 营收未录 · 截至 {q.end}</div>
          {:else}
            <div class="yrev num">—</div>
            <div class="yrevlbl">营收未录 · 截至 {q.end}</div>
            <div class="yrow"><span class="l">净利润</span><span class="v num">{q.niLabel}</span></div>
            <div class="yrow"><span class="l">净利率</span><span class="v num">{q.nmLabel}</span></div>
          {/if}
          <span class="yopen">查看季度 →</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="section-h">按财年下钻 · 实际年度</div>
  <div class="years">
    {#each yearRows as y (y.fy)}
      <button class="ycard" onclick={() => nav.goDetail(c.id, y.fy)}>
        <div class="yhead"><span class="yfy">{y.fy}</span><span class="ybadge act">实际</span></div>
        <div class="yrev num">{y.revLabel}</div>
        <div class="yrevlbl">营收{#if y.ry != null} · 同比 {Fmt.yoy(y.ry)}{/if}</div>
        <div class="yrow"><span class="l">净利润</span><span class="v num">{y.niLabel}</span></div>
        <div class="yrow"><span class="l">净利率</span><span class="v num">{y.nmLabel}</span></div>
        <span class="yopen">查看板块 →</span>
      </button>
    {/each}
  </div>

  {#if forecastRows.length}
    <div class="section-h">预测 · 非实际经营事实</div>
    <div class="years">
      {#each forecastRows as y (y.fy)}
        <button class="ycard is-fc" onclick={() => nav.goDetail(c.id, y.fy)}>
          <div class="yhead"><span class="yfy">{y.fy}</span><span class="ybadge fc">预测</span></div>
          <div class="yrev num">{y.revLabel}</div>
          <div class="yrevlbl">营收 · 卖方一致预期{#if inSrc} · USD 口径{/if}</div>
          <div class="yrow"><span class="l">净利润</span><span class="v num">{y.niLabel}</span></div>
          <div class="yrow"><span class="l">净利率</span><span class="v num">{y.nmLabel}</span></div>
          <span class="yopen">查看预测锚点 →</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="note-block"><b>口径说明：</b>{note}{#if inSrc} 当前为 <b>{srcCcy} 报告币种</b>视图：各期金额按该期财报入账汇率精确还原为原币（与官方披露逐位一致），同比按原币计算以剔除汇率折算影响；预测年（无原币载体）与估值快照仍为 USD。{/if}</div>
{/if}
