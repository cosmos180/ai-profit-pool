<script>
  // 面包屑（原 renderCrumbs）：读 nav + Store.byId，点击回跳。业务只从 lib/data.js 拿。
  import { nav } from '../lib/nav.svelte.js'
  import { Store, Selectors } from '../lib/data.js'

  const periodLabel = p => p?.calendar_year != null && p?.calendar_quarter ? `${p.calendar_year}${p.calendar_quarter}` : (p?.period_end || p?.period_id || '')

  // $derived：三级面包屑数据，输入是 nav 状态与 Store 原始值，不写回。
  const parts = $derived.by(() => {
    const arr = [{ label: '公司对比', go: () => nav.goHome() }]
    if (nav.view === 'comps') arr.push({ label: '估值横截面', go: null })
    if (nav.view === 'analysis') arr.push({ label: '高级分析', go: null })
    if (nav.companyId) {
      const c = Store.byId(nav.companyId)
      if (c) arr.push({ label: c.name, go: () => nav.goCompany(c.id) })
    }
    if (nav.view === 'detail' && nav.fy) arr.push({ label: nav.fy, go: null })
    if (nav.view === 'detail' && nav.periodId && nav.companyId) {
      const c = Store.byId(nav.companyId)
      const p = c ? Selectors.periods(c).find(x => x.period_id === nav.periodId) : null
      arr.push({ label: periodLabel(p) || nav.periodId, go: null })
    }
    return arr
  })
</script>

<nav class="crumbs">
  {#each parts as p, i (i)}
    {#if i}<span class="crumb-sep">/</span>{/if}
    {@const cur = i === parts.length - 1}
    <button
      class="crumb"
      class:cur
      disabled={cur || !p.go}
      onclick={() => { if (!cur && p.go) p.go() }}
    >{p.label}</button>
  {/each}
</nav>
