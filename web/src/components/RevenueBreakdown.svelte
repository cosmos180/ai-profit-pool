<script>
  // 产品/收入类型层级。与 segments[]（报告分部及分部利润）严格分开，避免重复计数。
  import { Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'

  let { owner, company = null, fy = null } = $props()

  const breakdown = $derived(Selectors.revenueBreakdown(owner))
  const meta = $derived(Selectors.revenueBreakdownMeta(owner))
  const rows = $derived.by(() => {
    const raw = Selectors.revenueBreakdownRows(owner)
    const maxPositive = Math.max(...raw.map(row => row.revenue > 0 ? row.revenue : 0), 1)
    return raw.map(row => ({
      ...row,
      revenueLabel: Fmt.bn(row.revenue, 2),
      shareLabel: Fmt.pct(row.share, 1),
      yoy: company && fy ? Selectors.revenueBreakdownYoY(company, fy, row.path) : null,
      barW: row.revenue > 0 ? (row.revenue / maxPositive * 100).toFixed(1) : '0',
      indent: `${row.depth * 22}px`,
      focus: /youtube/i.test(row.name),
    }))
  })
</script>

{#if breakdown && rows.length}
  <div class="section-h">{breakdown.label} · {meta.official ? '官方收入拆分' : '收入拆分（派生口径）'}{#if !meta.complete}<span class="rb-flag">不完整拆分</span>{/if}</div>
  <div class="card breakdown-card">
    <div class="plat">
      {#each rows as row (row.path)}
        <div class="platrow breakrow {row.hasChildren ? 'group' : ''} {row.focus ? 'focus' : ''} {row.revenue < 0 ? 'negative' : ''}">
          <div class="pt" style:padding-left={row.indent}>
            <span class="pname">
              {#if row.depth > 0}<span class="branch">↳</span>{/if}{row.name}
              {#if row.focus}<span class="producttag">产品收入</span>{/if}
            </span>
            <span class="pv num">{row.revenueLabel}<span class="sh">{row.shareLabel}</span></span>
          </div>
          <div class="ptrack" style:margin-left={row.indent}><div class="pfill" style:width="{row.barW}%"></div></div>
          {#if fy}
            <div class="pyoy" style:margin-left={row.indent}>
              {#if row.yoy == null}<span class="na">同比 n/a</span>{:else}<span class={row.yoy >= 0 ? 'up' : 'dn'}>同比 {Fmt.yoy(row.yoy)}</span>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    <div class="recon-line"><b>口径：</b>这是产品/收入类型层级{#if meta.complete}，完整顶层与公司营收对账{:else}；<b>不完整拆分（complete=false）</b>，顶层不与公司营收对账，占比仅供参考{/if}；它不代表产品独立利润。{#if !meta.official}数值为<b>派生口径</b>（如披露百分比 × 营收换算，见来源标注），非官方直接披露金额。{/if}对冲损益等调节项按官方表格单列，下方“业务板块”继续保留报告分部及其营业利润口径。</div>
  </div>
{/if}
