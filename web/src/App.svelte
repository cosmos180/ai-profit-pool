<script>
  // Scaffold smoke-test ONLY — proves the end-to-end path works before any view
  // porting: (1) Vite bundles the real ../companies.json at build time,
  // (2) a pure selector runs, (3) $derived enforces 派生值算不存 structurally,
  // (4) vite-plugin-singlefile inlines it all into one app.html.
  // The real Store/Selectors reuse + component tree land in later tasks (see ADR).
  import data from '../../companies.json'

  const companies = data.companies ?? []
  const populated = $derived(companies.filter((c) => c.status === 'populated' && c.years?.length))

  // A derived valuation multiple — declared, never stored (invariant #1).
  const latestActual = (c) => c.years.filter((y) => y.status === 'actual').at(-1) ?? null
  const pe = (c) => {
    const mc = c.quote?.market_cap,
      y = latestActual(c)
    return mc != null && y && y.net_income ? +(mc / y.net_income).toFixed(1) : null
  }
</script>

<main>
  <h1>AI 利润池 · <small>Svelte 5 脚手架自检</small></h1>
  <p>数据集已在构建期打包:{companies.length} 家公司(已补录 {populated.length} 家)。</p>
  <ul>
    {#each populated as c (c.id)}
      <li><b>{c.name}</b> — PE {pe(c) ?? '—'}</li>
    {/each}
  </ul>
</main>

<style>
  main {
    font: 15px/1.6 system-ui, sans-serif;
    max-width: 720px;
    margin: 3rem auto;
    padding: 0 1rem;
    color: #1a1a2e;
  }
  h1 {
    color: #6e8f2a;
  }
  small {
    font-weight: 400;
    color: #888;
  }
  li {
    margin: 0.15rem 0;
  }
</style>
