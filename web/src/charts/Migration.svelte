<script>
  // 利润池迁移图（原 renderMigration）：声明式 SVG，几何用 $derived。
  // 不变量：业务数据只来自 lib/data.js 的 Selectors；组件内不做财务算术
  // （share/value/total/yoy 均已在 Selectors 里算好，这里只做布局坐标——非财务量）。
  import { Selectors, STAGE_COLOR, Store } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'

  // --- 数据（全部来自 Selectors，null 透传）---
  const positions = $derived(Selectors.profitPoolMigration(Store.populated()))
  const enough = $derived(positions && positions.length >= 2)
  const ttm = $derived(Selectors.profitPoolTTM(Store.populated()))

  // 统一列模型：年度柱 + TTM 柱（isTTM 触发描边/斜纹/留空诚实处理）。
  const columns = $derived(
    enough
      ? positions.map(p => ({ ...p, isTTM: false })).concat([
          { label: 'TTM', sub: '截至各家最近季报', total: ttm.total, n: ttm.n, N: null, stages: ttm.stages, isTTM: true },
        ])
      : []
  )

  const first = $derived(enough ? positions[0] : null)
  const last = $derived(enough ? positions[positions.length - 1] : null)
  const ttmInvestShare = $derived(() => {
    const x = ttm.stages.find(t => t.stage === 'invest')
    return x ? x.share : null
  })

  // --- 布局常量（纯视觉几何，非财务）---
  const colW = 92, gap = 110, padL = 14, padT = 62, barH = 300, padB = 44
  const W = $derived(padL * 2 + columns.length * colW + (columns.length - 1) * (gap - colW))
  const H = padT + barH + padB
  const xOf = i => padL + i * gap

  // --- 每列几何：把原函数的坐标计算搬成 $derived 出的数组（输入=Selectors 返回值）---
  const cols = $derived.by(() => columns.map((p, pi) => {
    const x = xOf(pi)
    const tt = p.isTTM
    const topShift = tt ? 20 : 0
    // 自下而上按 STAGE_ORDER（stages 已排序）累计 share 切段
    let acc = 0
    const segs = []
    for (const st of p.stages) {
      const sh = st.share || 0
      const segH = sh * barH
      const yTop = padT + barH - (acc + sh) * barH
      acc += sh
      if (segH <= 0) continue
      segs.push({
        stage: st.stage,
        label: st.label,
        share: st.share,
        value: st.value,
        x, yTop, segH, colW,
        showLbl: sh >= 0.06,
        pctLbl: Fmt.pct(st.share, 0),
        aria: (tt ? 'TTM ' : p.label + ' ') + st.label + ' 占 ' + Fmt.pct(st.share, 1) + '，净利润 ' + Fmt.bn(st.value, 1),
      })
    }
    // TTM invest=0：软银未录季度（覆盖缺口，非利润归零）→ 顶部虚化空槽
    let investGap = null
    if (tt && (ttmInvestShare() ?? 0) <= 0) {
      const slotH = 15, slotGap = 5
      investGap = { x, y: padT - slotGap - slotH, w: colW, h: slotH }
    }
    return {
      x, tt, topShift, colW,
      total: p.total, n: p.n, N: p.N, label: p.label,
      segs, investGap,
    }
  }))

  // --- 图例（口径切到 TTM；箭头基准 = TTM 较最近完整年）---
  const legend = $derived.by(() => {
    if (!enough) return []
    return ttm.stages.map(st => {
      const prev = last.stages.find(s => s.stage === st.stage)
      let arrow
      if (st.stage === 'invest') {
        arrow = { kind: 'nc', text: '不可比（覆盖缺口）' }
      } else {
        const dShare = (prev && prev.share != null && st.share != null) ? st.share - prev.share : null
        if (dShare == null) arrow = { kind: 'plain', text: '—' }
        else if (dShare >= 0) arrow = { kind: 'up', text: '▲ ' + (dShare * 100).toFixed(1) + 'pt' }
        else arrow = { kind: 'dn', text: '▼ ' + (Math.abs(dShare) * 100).toFixed(1) + 'pt' }
      }
      const investEmpty = st.stage === 'invest' && !st.companies.length
      const members = investEmpty
        ? null
        : st.companies.map(m => ({ name: m.name.split(' ')[0], ttm: m.ttm, neg: m.ttm < 0 }))
      return {
        stage: st.stage,
        label: st.label,
        shareLbl: st.share != null ? Fmt.pct(st.share, 1) + ' · ' : '',
        valueLbl: Fmt.bn(st.value, 1),
        arrow,
        investEmpty,
        members,
      }
    })
  })

  // --- 交互：图例 ↔ 色块联动高亮（hover + focus + 点击）---
  let active = $state(null)
  const setActive = s => { active = s }
  const toggle = s => { active = active === s ? null : s }
</script>

<div class="card mig-card">
  {#if !enough}
    <div class="note-block" style="margin-top:0"><b>样本不足。</b>利润池迁移需要至少两个所有公司都有实际净利润的完整财年位置，当前不足，诚实留空。</div>
  {:else}
    <p class="mig-lead"><span class="caliper-inline">AI 归因加权</span>同一批公司的净利润<b>按 AI 占比加权后</b>，再按价值链<b>环节</b>归桶看结构（缺 AI 占比的公司不计入，故每根柱标<b>覆盖 n/N</b>）。前两根是已完成财年（{first.label}→{last.label}，覆盖 {last.n}/{last.N} 家），最右<b>斜纹虚线柱</b>是 <b>TTM 滚动 12 个月</b>（补最新季报、同样 AI 加权、{ttm.n} 家），与左侧年度柱<b>口径一致、高低可比</b>。柱越往上堆，越能看出<b>总量做大</b>的同时<b>结构在迁移</b>——TTM 让<b>存储环节明显鼓起</b>（HBM/AI 超级周期，年度口径看不到、TTM 才抓到）。AI 占比口径见上方说明。</p>

    <div class="mig-body">
      <div class="mig-chart">
        <svg class="mig-svg" class:dim={active != null} viewBox="0 0 {W} {H}" width={W} height={H}
             role="img" aria-label="AI 利润池利润结构按环节的百分比堆叠迁移图，含最右 TTM 滚动估算柱">
          <defs>
            <pattern id="migHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="none" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#fff" stroke-width="1.4" stroke-opacity="0.5" />
            </pattern>
          </defs>

          {#each cols as c (c.label)}
            <!-- 柱顶绝对总量 + 覆盖家数 -->
            <text x={c.x + c.colW / 2} y={padT - 25 - c.topShift} text-anchor="middle"
                  font-family="var(--mono)" font-size="14" font-weight="600"
                  fill={c.tt ? '#5b4d86' : 'var(--ink)'}>{Fmt.bn(c.total, 0)}</text>
            <text x={c.x + c.colW / 2} y={padT - 11 - c.topShift} text-anchor="middle"
                  font-family="var(--mono)" font-size="9.5" font-weight="500" fill="var(--ink-faint)"
            >{c.tt ? `对应 ${c.n} 家` : `覆盖 ${c.n}/${c.N} 家`}</text>

            <!-- 列名 -->
            {#if c.tt}
              <text x={c.x + c.colW / 2} y={padT + barH + 18} text-anchor="middle" font-family="var(--mono)" font-size="12" font-weight="600" fill="#5b4d86">TTM</text>
              <text x={c.x + c.colW / 2} y={padT + barH + 31} text-anchor="middle" font-family="var(--mono)" font-size="9.5" font-weight="500" fill="var(--ink-faint)">截至各家最近季报</text>
            {:else}
              <text x={c.x + c.colW / 2} y={padT + barH + 19} text-anchor="middle" font-family="var(--mono)" font-size="11.5" font-weight="600" fill="var(--ink-soft)">{c.label}</text>
            {/if}

            <!-- 堆叠段 -->
            {#each c.segs as s (s.stage)}
              <g class="mig-seg" class:on={active === s.stage} data-stage={s.stage} tabindex="0" role="button"
                 aria-label={s.aria}
                 onmouseenter={() => setActive(s.stage)} onmouseleave={() => setActive(null)}
                 onfocus={() => setActive(s.stage)} onblur={() => setActive(null)}>
                <rect x={s.x} y={s.yTop.toFixed(2)} width={s.colW} height={s.segH.toFixed(2)}
                      fill={STAGE_COLOR[s.stage]} fill-opacity={c.tt ? '0.86' : '1'} />
                {#if c.tt}
                  <rect x={s.x} y={s.yTop.toFixed(2)} width={s.colW} height={s.segH.toFixed(2)} fill="url(#migHatch)" pointer-events="none" />
                {/if}
                {#if s.showLbl}
                  <text x={s.x + s.colW / 2} y={(s.yTop + s.segH / 2 + 3.5).toFixed(2)} text-anchor="middle"
                        font-family="var(--mono)" font-size="11" font-weight="600" fill="#fff" pointer-events="none">{s.pctLbl}</text>
                {/if}
              </g>
            {/each}

            <!-- TTM invest 覆盖缺口槽 -->
            {#if c.investGap}
              <g class="mig-seg" class:on={active === 'invest'} data-stage="invest" tabindex="0" role="button"
                 aria-label="TTM 投资环节为覆盖缺口：软银未录季度，非利润归零"
                 onmouseenter={() => setActive('invest')} onmouseleave={() => setActive(null)}
                 onfocus={() => setActive('invest')} onblur={() => setActive(null)}>
                <rect x={c.investGap.x} y={c.investGap.y.toFixed(2)} width={c.investGap.w} height={c.investGap.h} fill={STAGE_COLOR.invest} fill-opacity="0.10" />
                <rect x={c.investGap.x} y={c.investGap.y.toFixed(2)} width={c.investGap.w} height={c.investGap.h} fill="url(#migHatch)" stroke={STAGE_COLOR.invest} stroke-opacity="0.55" stroke-dasharray="3 2" pointer-events="none" />
                <text x={c.investGap.x + c.investGap.w / 2} y={(c.investGap.y + c.investGap.h / 2 + 3).toFixed(2)} text-anchor="middle" font-family="var(--mono)" font-size="8.5" fill="#5b4d86" pointer-events="none">投资·缺口</text>
              </g>
            {/if}

            <!-- 柱体外框 -->
            <rect x={c.x} y={padT} width={c.colW} height={barH} fill="none"
                  stroke={c.tt ? STAGE_COLOR.invest : 'rgba(24,33,29,.10)'} stroke-opacity={c.tt ? '0.7' : '1'}
                  stroke-width={c.tt ? '1.5' : '1'} stroke-dasharray={c.tt ? '5 3' : 'none'} />
          {/each}
        </svg>
      </div>

      <div class="mig-side">
        <div class="mig-legend">
          {#each legend as li (li.stage)}
            <button class="mig-li" class:on={active === li.stage} data-stage={li.stage}
                    onmouseenter={() => setActive(li.stage)} onmouseleave={() => setActive(null)}
                    onfocus={() => setActive(li.stage)} onblur={() => setActive(null)}
                    onclick={() => toggle(li.stage)}>
              <span class="sw" style="background:{STAGE_COLOR[li.stage]}"></span>
              <span class="lt">
                <span class="ln">{li.label}<span class="lsh">{li.shareLbl}{li.valueLbl}</span></span>
                <span class="lc">
                  {#if li.investEmpty}
                    <span class="gap-note">软银季度净利受投资损益主导，未纳入 TTM（覆盖缺口，非真实归零）</span>
                  {:else if li.members && li.members.length}
                    {#each li.members as m, mi (m.name)}{#if mi}、{/if}<span class:neg={m.neg}>{m.name} {Fmt.bn(m.ttm, 1)}</span>{/each}
                  {:else}—{/if}
                </span>
                <span class="lar">TTM 占比　较 {last.label}
                  {#if li.arrow.kind === 'nc'}<span class="nc">{li.arrow.text}</span>
                  {:else if li.arrow.kind === 'up'}<span class="up">{li.arrow.text}</span>
                  {:else if li.arrow.kind === 'dn'}<span class="dn">{li.arrow.text}</span>
                  {:else}{li.arrow.text}{/if}
                </span>
              </span>
            </button>
          {/each}
        </div>
      </div>
    </div>

    <div class="mig-foot">
      <span class="n">①</span>年度柱各公司财年口径不一（英伟达 1 月末、软银 3 月末、美光 8 月末、博通 10 月末，余为自然年），按实际年位置近似对齐为同一"年"，<b>存在数月错位、非精确同期可比</b>。
      <span class="n">②</span>混业公司按主营归桶：三星（存储+代工+消费）计入<b>存储</b>，博通（含软件）计入<b>设计</b>。
      <span class="n">③</span>投资环节（软银）为<b>投资损益口径、非经营利润</b>，与其余经营利润性质不同，同图并列仅为看结构。
      <span class="n">④</span><span class="ttm-tag">TTM</span> 为<b>滚动 12 个月估算、非已完成财年</b>（故用斜纹虚线区分）；各家截止日不一（跨度 {ttm.asOfSpreadDays} 天，美光季末 5-28、其余多为 3-31），横截面<b>非精确同期</b>。TTM 仅 {ttm.n} 家：软银季度净利受投资损益主导未录季度，<b>TTM 投资环节为覆盖缺口、非利润归零</b>，故 TTM 合计（{ttm.n} 家）<b>不可与年度柱（{last.n} 家）直接比高低</b>。
    </div>
  {/if}
</div>
