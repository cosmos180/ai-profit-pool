<script>
  // 产品/收入类型层级。与 segments[]（报告分部及分部利润）严格分开，避免重复计数。
  import { Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'

  let { owner, company = null, fy = null, periodId = null } = $props()

  const isQuarter = $derived(owner?.kind === 'quarter')
  // 季度拆分行显示同比/环比两枚 chip（值+原因分流由 Selector 备好，组件零财务算术）
  const showQuarterDelta = $derived(isQuarter && !!company && !!periodId)

  // null 原因 → 微标 + title 人话（视图文案，非计算）
  function deltaText(kind, reason) {
    const noPrior = kind === 'yoy' ? '缺上年同季' : '缺上季原子'
    const map = {
      no_prior: { short: noPrior, title: kind === 'yoy'
        ? '缺上一年同一自然季的报告期原子，无法算同比——诚实留空，不伪造'
        : '缺相邻上一自然季的报告期原子（如美股 filer 财年末无独立 Q4 原子），无法算环比——诚实留空' },
      no_breakdown: { short: kind === 'yoy' ? '上年同季未录拆分' : '上季未录拆分', title: '对比季原子存在，但该期尚未录入产品收入拆分——属可补数据缺口，补录后自动点亮' },
      name_mismatch: { short: '行名不一致', title: '对比季有拆分，但找不到同路径的同名行——可能是本期新增行、公司改名/重列了口径、或对比季未完整录入；名称对不上时不硬算' },
      no_base: { short: '基期缺失', title: '对比季该拆分行营收缺失或为 0，无法算比率——诚实留空' },
    }
    return map[reason] || { short: 'n/a', title: '' }
  }

  const breakdown = $derived(Selectors.revenueBreakdown(owner))
  const meta = $derived(Selectors.revenueBreakdownMeta(owner))
  const rows = $derived.by(() => {
    const raw = Selectors.revenueBreakdownRows(owner)
    const maxPositive = Math.max(...raw.map(row => row.revenue > 0 ? row.revenue : 0), 1)
    return raw.map(row => ({
      ...row,
      revenueLabel: Fmt.bn(row.revenue, 2),
      shareLabel: Fmt.pct(row.share, 1),
      yoy: company && fy && owner?.kind === 'annual'
        ? Selectors.annualRevenueBreakdownYoY(company, fy, row.path)
        : null,
      delta: showQuarterDelta
        ? Selectors.quarterRevenueBreakdownDelta(company, periodId, row.path)
        : null,
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
          {#if showQuarterDelta && row.delta}
            <div class="pyoy" style:margin-left={row.indent}>
              {#each [['yoy', '同比'], ['qoq', '环比']] as [k, lbl], ci (k)}
                {@const d = row.delta[k]}
                {#if ci > 0}<span class="qsep">·</span>{/if}
                {#if d.value == null}
                  {@const t = deltaText(k, d.reason)}
                  <span class="na" title={t.title}>{lbl} {t.short}</span>
                {:else}
                  <span class={d.value >= 0 ? 'up' : 'dn'}>{lbl} {Fmt.yoy(d.value)}</span>
                {/if}
              {/each}
            </div>
          {:else if fy}
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

<style>
  .pyoy .qsep{color:var(--ink-faint);margin:0 8px}
</style>
