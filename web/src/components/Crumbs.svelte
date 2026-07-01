<script>
  // 面包屑（原 renderCrumbs）：读 nav + Store.byId，点击回跳。业务只从 lib/data.js 拿。
  import { nav } from '../lib/nav.svelte.js'
  import { Store } from '../lib/data.js'

  // $derived：三级面包屑数据，输入是 nav 状态与 Store 原始值，不写回。
  const parts = $derived.by(() => {
    const arr = [{ label: '公司对比', go: () => nav.goHome() }]
    if (nav.companyId) {
      const c = Store.byId(nav.companyId)
      if (c) arr.push({ label: c.name, go: () => nav.goCompany(c.id) })
    }
    if (nav.view === 'detail' && nav.fy) arr.push({ label: nav.fy, go: null })
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
