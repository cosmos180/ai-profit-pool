<script>
  // 营收/净利双柱 + 净利率折线（原 renderTrend）。声明式 SVG，几何用 $derived。
  // 原实现用 window resize 手动重画 clientWidth；这里改 onMount + ResizeObserver
  // 观测容器宽度，宽度变化驱动 $state → 几何 $derived 重算（自适应）。
  // 不变量：业务数据只来自 Selectors；坐标/比例是布局几何（非财务量），已注释说明。
  import { onMount } from 'svelte'
  import { Selectors } from '../lib/data.js'
  import { Safe } from '../lib/safe.js'

  let { company } = $props()

  const data = $derived(company?.years || [])

  // 容器实测宽度（布局量，ResizeObserver 驱动）。初值取原实现的下限 820。
  let hostW = $state(820)
  let host

  onMount(() => {
    if (!host || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width
        if (w > 0) hostW = w
      }
    })
    ro.observe(host)
    return () => ro.disconnect()
  })

  // —— 几何（纯布局坐标，非财务算术；原 renderTrend 的常量原样搬来）——
  const W = $derived(Math.max(560, hostW || 820))
  const padL = 40, padR = 20, padT = 24, padB = 46
  const H = 320
  const innerW = $derived(W - padL - padR)
  const innerH = H - padT - padB

  // 营收最大值定 y 轴刻度（布局用，非展示的业务值）。
  const max = $derived.by(() => {
    let m = Math.max(...data.map(y => y.revenue || 0), 0)
    if (m <= 0) m = 1
    return m * 1.08
  })
  const groupW = $derived(innerW / Math.max(data.length, 1))
  const barW = $derived(Math.min(46, groupW * 0.30))
  const yS = v => padT + innerH - (v / max) * innerH

  const gridlines = $derived(
    [0, 1, 2, 3, 4].map(i => {
      const gv = max * i / 4
      return { gy: yS(gv), label: gv.toFixed(0) }
    })
  )

  const bars = $derived(
    data.map((y, i) => {
      const cx = padL + groupW * i + groupW / 2
      const fc = y.status === 'forecast'
      const revY = yS(y.revenue)
      const niY = yS(y.net_income || 0)
      const x1 = cx - barW - 3, x2 = cx + 3
      return {
        cx, fc, x1, x2,
        revY, revH: Math.max(0, (y.revenue / max) * innerH), revFill: fc ? 'url(#h2)' : 'var(--past)',
        revLabel: y.revenue,
        // niH 用于矩形高度（布局量），净利为负时钳到 0 避免非法负高度（如软银 FY2023 -1.5B）；
        // 真实数值仍由 niLabel 如实呈现（-1.504），不伪造。原实现未钳，本迁移做无损修正。
        niY, niH: Math.max(0, ((y.net_income || 0) / max) * innerH), niFill: fc ? 'url(#h3)' : 'var(--ok)',
        niLabel: y.net_income || '—',  // 原 renderTrend 用 ||：净利为 0/null 均显 "—"（呈现降级，非业务算术）
        fy: y.fy,
      }
    })
  )

  // 净利率折线（netMargin 来自 Selectors，null 段过滤）。my/cx 是坐标（布局量）。
  const mline = $derived(
    data
      .map((y, i) => {
        const nm = Selectors.netMargin(y)
        if (nm == null) return null
        const cx = padL + groupW * i + groupW / 2
        return { cx, my: padT + (1 - nm) * innerH * 0.42, nm }
      })
      .filter(Boolean)
  )
  const mpoints = $derived(mline.map(p => p.cx + ',' + p.my).join(' '))

  const heading = $derived(
    data.length ? `营收与净利润 · ${data[0].fy} → ${data[data.length - 1].fy}` : '营收与净利润'
  )
</script>

<div class="section-h">{heading}</div>
<div class="card chart-card" bind:this={host}>
  {#if !data.length}
    <svg viewBox="0 0 560 120" style="width:100%;height:120px" role="img" aria-label="营收与净利润趋势">
      <text x="280" y="64" text-anchor="middle" font-family="var(--mono)" font-size="12" fill="var(--ink-faint)">无趋势数据</text>
    </svg>
  {:else}
    <svg viewBox="0 0 {W} {H}" style="width:100%;height:{H}px" role="img" aria-label="营收与净利润趋势">
      <defs>
        <pattern id="h2" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill="var(--past)" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#fff" stroke-width="2" opacity=".55" />
        </pattern>
        <pattern id="h3" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill="var(--ok)" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#fff" stroke-width="2" opacity=".55" />
        </pattern>
      </defs>

      {#each gridlines as g}
        <line x1={padL} y1={g.gy} x2={W - padR} y2={g.gy} stroke="var(--line-soft)" />
        <text x={padL - 6} y={g.gy + 3} text-anchor="end" font-family="var(--mono)" font-size="9.5" fill="var(--ink-faint)">{g.label}</text>
      {/each}

      {#each bars as b (b.fy)}
        <rect x={b.x1} y={b.revY} width={barW} height={b.revH} rx="3" fill={b.revFill} />
        <text x={b.x1 + barW / 2} y={b.revY - 5} text-anchor="middle" font-family="var(--mono)" font-size="10" font-weight="600" fill="var(--ink-soft)">{b.revLabel}</text>
        <rect x={b.x2} y={b.niY} width={barW} height={b.niH} rx="3" fill={b.niFill} />
        <text x={b.x2 + barW / 2} y={b.niY - 5} text-anchor="middle" font-family="var(--mono)" font-size="10" font-weight="600" fill="var(--ok-deep)">{b.niLabel}</text>
        <text x={b.cx} y={H - padB + 18} text-anchor="middle" font-family="var(--mono)" font-size="11" font-weight={b.fc ? '400' : '600'} fill={b.fc ? 'var(--est)' : 'var(--ink)'}>{Safe.text(b.fy)}</text>
      {/each}

      {#if mline.length > 1}
        <polyline points={mpoints} fill="none" stroke="var(--ink-soft)" stroke-width="1.6" stroke-dasharray="4 3" />
        {#each mline as p}
          <circle cx={p.cx} cy={p.my} r="2.6" fill="var(--ink-soft)" />
          <text x={p.cx} y={p.my - 7} text-anchor="middle" font-family="var(--mono)" font-size="9" fill="var(--ink-soft)">{(p.nm * 100).toFixed(0)}%</text>
        {/each}
      {/if}
    </svg>
  {/if}

  <div class="chart-legend">
    <div class="i"><span class="lg" style="background:var(--past)"></span>营收（实际）</div>
    <div class="i"><span class="lg" style="background:var(--ok)"></span>净利润（实际）</div>
    <div class="i"><span class="lg lg-hatch"></span>预测</div>
    <div class="i"><span class="lg" style="background:transparent;border-top:2px dashed var(--ink-soft);height:2px;border-radius:0;margin-top:5px"></span>净利率 %</div>
  </div>
</div>
