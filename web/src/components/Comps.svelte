<script>
  // A1 估值横截面对比（新顶层视图 comps）：一屏并列 14 行 × 4 估值列（+公司+环节），任列可排序。
  // 组件只持 sortCol/sortDir + 两个显示开关（相对位/PS）这几个 UI 状态；一切值/状态/排序键/
  // caveat 因由/同环节相对位由 Selectors.compsTable() 一次备好。组件内无任何财务算术——
  // 只做「取值 + 排序（比 cell.sortKey）+ Fmt 渲染」。业务只从 lib/data.js 取。
  import { nav } from '../lib/nav.svelte.js'
  import { Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'

  const table = $derived(Selectors.compsTable())

  // UI 状态：从 selector 的 defaultSort 初始化（契约单写），两个密度开关默认关。
  let sortCol = $state(table.defaultSort.col)
  let sortDir = $state(table.defaultSort.dir)
  let showRel = $state(false)   // 同环节相对位角标
  let showPS = $state(false)    // + PS 列

  // 关闭 PS 开关时，若当前正按（即将隐藏的）PS 列排序，恢复默认排序——
  // 否则表格会被一个不可见的列排序且无激活列提示。
  $effect(() => {
    if (!showPS && sortCol === 'ps') {
      sortCol = table.defaultSort.col
      sortDir = table.defaultSort.dir
    }
  })

  // 可见列：optional 的 PS 仅当开关开时出现；数值列（排序 chip / 单元格）= 去掉公司/环节。
  const columns = $derived(table.columns.filter(col => !col.optional || (col.key === 'ps' && showPS)))
  const numCols = $derived(columns.filter(col => col.sortable && col.key !== 'stage'))

  // 排序：只读 cell.sortKey；null 恒沉底（与升降无关）；stage 按 stage.sortKey。
  // 属「取值/排序」而非财务算术——不碰 value、不做业务算数。
  const sortedRows = $derived.by(() => {
    const rows = table.rows.slice()
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortCol === 'stage') {
      rows.sort((a, b) => (a.stage.sortKey - b.stage.sortKey) * dir)
      return rows
    }
    rows.sort((a, b) => {
      const ka = a.cells[sortCol]?.sortKey
      const kb = b.cells[sortCol]?.sortKey
      if (ka == null && kb == null) return 0
      if (ka == null) return 1   // — 恒沉底
      if (kb == null) return -1
      return ka < kb ? -dir : ka > kb ? dir : 0
    })
    return rows
  })

  function selectSort(key) {
    if (sortCol === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    else { sortCol = key; sortDir = 'asc' }
  }

  const ariaSort = col =>
    sortCol === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : (col.sortable ? 'none' : undefined)

  // 纯呈现：按 kind 选 Fmt（非计算）。
  const fmtCell = cell => cell.kind === 'pct' ? Fmt.pct(cell.value) : Fmt.mult(cell.value)

  // 同环节相对位角标：class 与悬浮文案（方向语义据 lowerCheaper 分流，纯呈现）。
  const relCls = rel => {
    if (rel.relative === 'mid') return 'mid'
    if (rel.relative === 'low') return rel.lowerCheaper ? 'cheap' : 'pricey'
    return rel.lowerCheaper ? 'pricey' : 'cheap'   // high
  }
  const relTitle = (rel, kind) =>
    `同环节 ${rel.cohortN} 家 · 中位 ${kind === 'pct' ? Fmt.pct(rel.median) : Fmt.mult(rel.median)}`
</script>

<h1 class="title">估值横截面对比</h1>
<p class="lead">{table.rows.length} 家 AI 价值链公司的 trailing / 前瞻倍数并列，任一列点表头即可排序。</p>
<p class="comps-caption">价格截至市场快照日，倍数分母用各公司最新实际财年业绩（两者时点不同，属正常）。</p>

<div class="comps-toolbar">
  <label class="comps-switch"><input type="checkbox" bind:checked={showRel} /> 同环节相对位</label>
  <label class="comps-switch"><input type="checkbox" bind:checked={showPS} /> + PS 列</label>
</div>

<div class="sort-ctl" role="group" aria-label="排序控制">
  <span class="sc-lbl">排序</span>
  {#each numCols as col (col.key)}
    <button class="sc-chip" aria-pressed={sortCol === col.key} onclick={() => selectSort(col.key)}>{col.label}</button>
  {/each}
  <button class="sc-dir" onclick={() => (sortDir = sortDir === 'asc' ? 'desc' : 'asc')} title="切换升/降序">
    {sortDir === 'asc' ? '▲ 升序' : '▼ 降序'}
  </button>
</div>

<div class="comps-scroll">
  <table class="comps-table">
    <thead>
      <tr>
        {#each columns as col (col.key)}
          <th
            class="ch"
            class:accent={col.accent}
            class:cc-col={col.key === 'name'}
            class:sorted={sortCol === col.key}
            scope="col"
            aria-sort={ariaSort(col)}
          >
            {#if col.sortable}
              <button class="ch-btn" class:num-h={col.key !== 'stage'} onclick={() => selectSort(col.key)}>
                <span class="ch-lbl">{col.label}{#if sortCol === col.key}<span class="ch-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>{:else}<span class="ch-idle">⇅</span>{/if}</span>
                {#if col.sub}<span class="ch-sub">{col.sub}</span>{/if}
                {#if col.covered != null}<span class="col-cover">{col.covered}/{col.total} 有值</span>{/if}
              </button>
            {:else}
              <span class="ch-lbl static">{col.label}</span>
            {/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each sortedRows as r (r.id)}
        <tr>
          <td class="cc-name">
            <button class="cc-link" onclick={() => nav.goCompany(r.id)} title="查看 {r.name} 详情">
              <span class="logo {r.logo_class}"><span>{r.logo_text}</span></span>
              <span class="cc-txt"><span class="cc-cn">{r.name}</span><span class="cc-sn">{r.shortName}</span></span>
            </button>
          </td>
          <td class="cst">
            <span class="segtag2" style="--tag:{r.stage.color}">{r.stage.label}</span>
          </td>
          {#each numCols as col (col.key)}
            {@const cell = r.cells[col.key]}
            <td class="cv num" class:accent={col.accent}>
              {#if showRel && cell.rel && !cell.rel.insufficient && cell.rel.relative}
                <span class="cv-rel {relCls(cell.rel)}" title={relTitle(cell.rel, col.kind)}></span>
              {/if}
              {#if cell.state === 'ok'}
                <span class="cv-val">{fmtCell(cell)}</span>
              {:else if cell.state === 'distorted'}
                <span class="cv-val">{fmtCell(cell)}</span><span class="cv-flag distort" title={cell.note}>⚠</span>
              {:else if cell.state === 'na'}
                <span class="cv-dash muted">—</span><span class="cv-flag na" title={cell.note}>不适用</span>
              {:else}
                <span class="cv-dash muted">—</span><span class="cv-flag todo" title={cell.note}>待补</span>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<details class="caveat-note comps-caveat">
  <summary>为何部分格留空或降级？<span class="cn-hint">口径说明 ⌄</span></summary>
  <p>{table.caveatNote}</p>
</details>
