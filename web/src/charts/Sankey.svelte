<script module>
  // 利润表资金流桑基（原 renderIncomeSankey）。
  // 技术债（ADR 决策4）：原实现是命令式 band/advance 累积 SVG 字符串（curX/curVal/curTop
  // 逐段推进），改声明式 {#each} 需大改几何推进逻辑、风险高，故过渡期保留"纯函数 svg + {@html}"。
  // 该纯函数【不做任何财务算术】：一切金额/比率来自 Selectors.incomeFlow(y) 与 Selectors.op/netMargin，
  // 函数内只做布局坐标与 px 缩放（scale=barH/rev，bn→px 是流带宽度∝金额的桑基几何，非财务量）。
  // has.* 为 false 时优雅降级；taxOther 负值（net>op）方向为"非经营收益流入"，不取绝对值。
  import { Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'
  import { Safe } from '../lib/safe.js'

  // 返回 { svg, notes[], showInflowLegend } —— 供模板声明式渲染 legend/foot，svg 走 {@html}。
  export function buildSankey(c, y) {
    const f = Selectors.incomeFlow(y)
    if (f.revenue == null) return null // 无营收 → 整图不可用
    const rev = f.revenue
    const COL = { rev: 'var(--past)', profit: 'var(--ok)', out: 'var(--bad)', ai: 'var(--ai)', seg: '#9AA8A0', inflow: 'var(--ok-soft)' }
    const negProfit = (f.opProfit != null && f.opProfit < 0) || (f.netIncome != null && f.netIncome < 0)

    const gm = y.gross_margin
    const om = Selectors.opMargin(y)
    const nm = Selectors.netMargin(y)

    // 布局参数（纯几何）
    const padL = 14, padT = 20, padB = 20
    const segColW = 150, nodeW = 120, gapW = 92
    const barH = 360
    const scale = barH / rev
    const px = v => Math.max(0, (v || 0) * scale)

    const hasGross = f.has.gross, hasOpex = f.has.opex

    let cx = padL
    const segX = f.has.segments ? padL : null
    if (f.has.segments) cx = padL + segColW + gapW
    const revX = cx; cx += nodeW + gapW
    let grossX = null, opX = null, netX = null
    if (hasGross) { grossX = cx; cx += nodeW + gapW }
    if (hasOpex) { opX = cx; cx += nodeW + gapW }
    netX = cx; cx += nodeW
    const W = cx + padL + 8
    const H = padT + barH + padB + 70

    const topY = padT

    // A1：不再写死 width/height 属性——viewBox 定内部坐标，外层 CSS（.sankey-svg
    // width:100% + max-width:--sankeyW）等比缩放，窄屏完整可见无横向滚动、桌面不过拉。
    let s = `<svg class="sankey-svg" viewBox="0 0 ${W} ${H}" role="img" `
      + `aria-label="${Safe.attr(c.name + ' ' + y.fy + ' 利润表资金流：营收 ' + Fmt.bn(rev) + ' 至净利润 ' + Fmt.bn(f.netIncome) + '，按金额宽度的桑基图')}">`

    const band = (x0, yT0, yB0, x1, yT1, yB1, fill, op) => {
      const mx = (x0 + x1) / 2
      return `<path d="M${x0} ${yT0} C${mx} ${yT0} ${mx} ${yT1} ${x1} ${yT1} `
        + `L${x1} ${yB1} C${mx} ${yB1} ${mx} ${yB0} ${x0} ${yB0} Z" fill="${fill}" fill-opacity="${op || 0.55}"/>`
    }
    const node = (x, yT, h, fill, op) => `<rect x="${x}" y="${yT}" width="${nodeW}" height="${h}" rx="3" fill="${fill}" fill-opacity="${op || 1}"/>`
    const nlabel = (x, yT, h, name, amt, ratio, ratioLbl, small) => {
      const cxn = x + nodeW / 2; let t = ''
      const fs = small ? 10 : 11.5
      t += `<text class="nlabel" x="${cxn}" y="${yT - 21}" text-anchor="middle" font-size="${fs}" fill="var(--ink)">${Safe.text(name)}</text>`
      t += `<text class="nlabel" x="${cxn}" y="${yT - 7}" text-anchor="middle" font-size="${small ? 11 : 12.5}" fill="var(--ink)">${Safe.text(amt)}</text>`
      if (ratio != null) t += `<text class="nsub" x="${cxn}" y="${yT + h + 14}" text-anchor="middle" font-size="9.5">${Safe.text(ratioLbl)} ${Safe.text(ratio)}</text>`
      return t
    }

    // —— 左：分部支流汇入营收 ——
    if (f.has.segments) {
      const segs = f.segments.filter(sg => sg.revenue > 0)
      let accY = topY
      const n = segs.length
      const srcGap = barH / Math.max(n, 1)
      segs.forEach((sg, i) => {
        const h = px(sg.revenue)
        const srcCy = topY + srcGap * i + srcGap / 2
        const srcT = srcCy - Math.min(h, srcGap * 0.7) / 2, srcB = srcCy + Math.min(h, srcGap * 0.7) / 2
        const dstT = accY, dstB = accY + h; accY += h
        const fill = sg.is_ai ? COL.ai : COL.seg
        s += band(segX + segColW, srcT, srcB, revX, dstT, dstB, fill, sg.is_ai ? 0.5 : 0.4)
        const shareTxt = Fmt.pctCompact(sg.share)  // 占营收比（Selector 已给 share，分母=y.revenue）
        s += `<text x="${segX}" y="${srcCy - 2}" font-size="10.5" font-family="var(--mono)" font-weight="600" fill="${sg.is_ai ? 'var(--ai)' : 'var(--ink-soft)'}">${Safe.text(sg.name.split(' ')[0])}${sg.is_ai ? ' ●' : ''}</text>`
        s += `<text x="${segX}" y="${srcCy + 11}" font-size="9.5" font-family="var(--mono)" fill="var(--ink-faint)">${Safe.text(Fmt.bn(sg.revenue, 1))} · ${Safe.text(shareTxt)}</text>`
      })
    }

    // —— 营收节点 ——
    s += node(revX, topY, px(rev), COL.rev, 0.9)
    s += nlabel(revX, topY, px(rev), '营收', Fmt.bn(rev, 1), null, null, false)

    let curX = revX, curVal = rev, curTop = topY

    const advance = (nextX, outVal, outName, outAmt, outColor, outOp, nextVal, nextFill, nextName, nextAmt, nextRatio, nextRatioLbl, inflow) => {
      const curH = px(curVal)
      if (inflow) {
        const inH = px(outVal)
        s += band(curX + nodeW, curTop, curTop + curH, nextX, topY + (px(nextVal) - curH), topY + px(nextVal), COL.profit, 0.42)
        const inT = topY, inB = topY + inH
        s += band(nextX - gapW * 0.5, H - padB - 40 - inH, H - padB - 40, nextX, inT, inB, COL.inflow, 0.7)
        s += `<text x="${nextX - gapW * 0.5}" y="${H - padB - 46 - inH}" font-size="9.5" font-family="var(--mono)" fill="var(--ok-deep)">${Safe.text(outName)}</text>`
        s += `<text x="${nextX - gapW * 0.5}" y="${H - padB - 34}" font-size="9.5" font-family="var(--mono)" fill="var(--ok-deep)">+${Safe.text(outAmt)}</text>`
      } else {
        const outH = px(outVal)
        const rightVal = nextVal
        const rightH = px(rightVal)
        s += band(curX + nodeW, curTop, curTop + rightH, nextX, topY, topY + rightH, COL.profit, 0.42)
        if (outH > 0.5) {
          const oT = curTop + rightH, oB = curTop + curH
          const floorY = H - padB - 44
          s += `<path d="M${curX + nodeW} ${oT} C${curX + nodeW + 30} ${oT} ${curX + nodeW + 30} ${floorY} ${curX + nodeW + gapW * 0.5} ${floorY} `
            + `L${curX + nodeW + gapW * 0.5} ${floorY + outH} C${curX + nodeW + 30} ${floorY + outH} ${curX + nodeW + 30} ${oB} ${curX + nodeW} ${oB} Z" fill="${outColor}" fill-opacity="${outOp || 0.5}"/>`
          s += `<text x="${curX + nodeW + gapW * 0.5 + 6}" y="${floorY + Math.min(outH / 2, 14) + 2}" font-size="9.5" font-family="var(--mono)" fill="${outColor}">${Safe.text(outName)} ${Safe.text(outAmt)}</text>`
        }
      }
      curX = nextX; curVal = nextVal; curTop = topY
      s += node(nextX, topY, px(nextVal), nextFill, 0.9)
      s += nlabel(nextX, topY, px(nextVal), nextName, nextAmt, nextRatio, nextRatioLbl, false)
    }

    if (negProfit) {
      const floorY = H - padB - 44
      const eatenY0 = topY, eatenY1 = topY + px(rev)
      s += `<path d="M${revX + nodeW} ${eatenY0} C${revX + nodeW + 40} ${eatenY0} ${revX + nodeW + 40} ${floorY} ${revX + nodeW + gapW * 0.6} ${floorY} `
        + `L${revX + nodeW + gapW * 0.6} ${floorY + px(rev)} C${revX + nodeW + 40} ${floorY + px(rev)} ${revX + nodeW + 40} ${eatenY1} ${revX + nodeW} ${eatenY1} Z" fill="${COL.out}" fill-opacity="0.32"/>`
      s += `<text x="${revX + nodeW + gapW * 0.6 + 6}" y="${floorY + 16}" font-size="10" font-family="var(--mono)" fill="${COL.out}">总成本+费用 ${Safe.text(Fmt.bn(rev - f.netIncome, 1))}</text>`
      s += `<text x="${revX + nodeW + gapW * 0.6 + 6}" y="${floorY + 30}" font-size="9" font-family="var(--mono)" fill="var(--ink-faint)">本年营收无法覆盖，转为亏损</text>`
      const lh = Math.max(px(Math.abs(f.netIncome)), 18)
      s += `<path d="M${revX + nodeW + gapW * 0.6 + 150} ${floorY + 8} C${netX - 30} ${floorY + 8} ${netX - 30} ${topY + lh / 2} ${netX} ${topY + lh / 2}" fill="none" stroke="${COL.out}" stroke-width="1.3" stroke-dasharray="4 3" stroke-opacity="0.5"/>`
      s += `<rect x="${netX}" y="${topY}" width="${nodeW}" height="${lh}" rx="3" fill="${COL.out}" fill-opacity="0.16" stroke="${COL.out}" stroke-width="1.5"/>`
      s += `<text class="nlabel" x="${netX + nodeW / 2}" y="${topY - 21}" text-anchor="middle" font-size="11.5" fill="var(--bad)">净亏损</text>`
      s += `<text class="nlabel" x="${netX + nodeW / 2}" y="${topY - 7}" text-anchor="middle" font-size="12.5" fill="var(--bad)">${Safe.text(Fmt.bn(f.netIncome, 1))}</text>`
      s += `<text class="nsub" x="${netX + nodeW / 2}" y="${topY + lh + 14}" text-anchor="middle" font-size="9.5" fill="var(--bad)">净利率 ${Safe.text(Fmt.pct(nm))}</text>`
      if (f.opProfit != null) {
        s += `<text class="nsub" x="${netX + nodeW / 2}" y="${topY + lh + 27}" text-anchor="middle" font-size="9" fill="var(--ink-faint)">经营利润 ${Safe.text(Fmt.bn(f.opProfit, 1))}（亦为负）</text>`
      }
    } else {
      if (hasGross) {
        advance(grossX, f.cogs, '成本 COGS', Fmt.bn(f.cogs, 1), COL.out, 0.45,
          f.grossProfit, COL.profit, '毛利', Fmt.bn(f.grossProfit, 1), Fmt.pct(gm), '毛利率')
      }
      if (hasOpex) {
        advance(opX, f.opex, '经营费用 Opex', Fmt.bn(f.opex, 1), COL.out, 0.5,
          f.opProfit, COL.profit, '经营利润', Fmt.bn(f.opProfit, 1), Fmt.pct(om), '经营利润率')
      }
      if (f.netIncome != null) {
        if (hasOpex && f.taxOther != null) {
          if (f.taxOther >= 0) {
            advance(netX, f.taxOther, '税+其他', Fmt.bn(f.taxOther, 1), COL.out, 0.5,
              f.netIncome, COL.profit, '净利润', Fmt.bn(f.netIncome, 1), Fmt.pct(nm), '净利率')
          } else {
            // taxOther<0：净利>经营利润 → 非经营收益流入（方向正确，不取绝对值展示原符号）
            advance(netX, -f.taxOther, '非经营收益', Fmt.bn(-f.taxOther, 1), COL.inflow, 0.7,
              f.netIncome, COL.profit, '净利润', Fmt.bn(f.netIncome, 1), Fmt.pct(nm), '净利率', true)
          }
        } else {
          // 降级直流（如软银：营收→净利，中间未拆分）
          const gapVal = rev - f.netIncome
          const niH = px(f.netIncome)
          const floorY = H - padB - 44
          s += band(curX + nodeW, curTop, curTop + niH, netX, topY, topY + niH, COL.profit, 0.42)
          if (gapVal > 0.5) {
            const oT = curTop + niH, oB = curTop + px(rev)
            s += `<path d="M${curX + nodeW} ${oT} C${curX + nodeW + 30} ${oT} ${curX + nodeW + 30} ${floorY} ${curX + nodeW + gapW * 0.5} ${floorY} `
              + `L${curX + nodeW + gapW * 0.5} ${floorY + px(gapVal)} C${curX + nodeW + 30} ${floorY + px(gapVal)} ${curX + nodeW + 30} ${oB} ${curX + nodeW} ${oB} Z" fill="${COL.out}" fill-opacity="0.30"/>`
            s += `<text x="${curX + nodeW + gapW * 0.5 + 6}" y="${floorY + 16}" font-size="9.5" font-family="var(--mono)" fill="${COL.out}">成本+费用+税 ${Safe.text(Fmt.bn(gapVal, 1))}</text>`
            s += `<text x="${curX + nodeW + gapW * 0.5 + 6}" y="${floorY + 29}" font-size="9" font-family="var(--mono)" fill="var(--ink-faint)">未披露毛利率，明细略</text>`
          }
          s += node(netX, topY, niH, COL.profit, 0.9)
          s += nlabel(netX, topY, niH, '净利润', Fmt.bn(f.netIncome, 1), Fmt.pct(nm), '净利率', false)
        }
      }
    }
    s += `</svg>`

    // —— 注脚（诚实说明降级）——
    const notes = []
    if (!hasGross) notes.push(`未披露毛利率，<b>略去成本/毛利拆分</b>，营收直接流向${hasOpex ? '经营利润' : '净利'}。`)
    if (!hasOpex && hasGross) notes.push(`未披露经营利润，<b>略去费用/经营利润段</b>。`)
    if (!hasOpex && !hasGross) notes.push(`仅披露营收与净利，中间环节为<b>未拆分的成本+费用+税</b>，按真实约束留作单一流出、不强行编造各段。`)
    if (negProfit) notes.push(`本财年<b>经营亏损</b>：成本与费用超过营收，利润链为负，故不画"向右流出利润"的流带（负宽度无意义），改以亏损节点标注。`)
    if (f.taxOther != null && f.taxOther < 0 && hasOpex) notes.push(`"非经营收益"为<b>流入</b>（净利 ${Fmt.bn(f.netIncome, 1)} > 经营利润 ${Fmt.bn(f.opProfit, 1)}），如利息/股权投资收益，按 GAAP 计入但非经营性。`)
    if (f.has.segments && f.segments.some(sg => sg.revenue <= 0)) notes.push(`营收为 0 的分部（如投资/基金口径）<b>不画支流</b>。`)

    return {
      svg: s,
      notes,
      showInflowLegend: f.taxOther != null && f.taxOther < 0 && hasOpex,
      fy: y.fy,
      width: W,   // 内部坐标宽度（px）→ 模板设 --sankeyW 作 max-width，防桌面过度拉伸
    }
  }
</script>

<script>
  import { buildSankey as _build } from './Sankey.svelte'

  let { company, year } = $props()

  const model = $derived(_build(company, year))
</script>

{#if model}
  <div class="section-h" style="margin-top:18px">利润表资金流 · {model.fy}</div>
  <div class="card sankey-card">
    <p class="sankey-lead">一张图看这年的钱<b>从哪来、被什么吃掉、最后剩多少</b>：左侧各分部汇成营收，向右每一步分出成本/费用/税（红，向下流出），剩下的利润（绿）继续向右，终点是净利润。<b>流带越宽＝金额越大</b>。</p>
    <div class="sankey-scroll" style="--sankeyW:{model.width}px">{@html model.svg}</div>
    <div class="sankey-legend">
      <div class="i"><span class="sw" style="background:var(--ai);opacity:.6"></span>AI 分部营收</div>
      <div class="i"><span class="sw" style="background:#9AA8A0;opacity:.5"></span>其他分部营收</div>
      <div class="i"><span class="sw" style="background:var(--ok);opacity:.55"></span>利润链（毛利/经营利润/净利）</div>
      <div class="i"><span class="sw" style="background:var(--bad);opacity:.5"></span>成本/费用/税（流出）</div>
      {#if model.showInflowLegend}
        <div class="i"><span class="sw" style="background:var(--ok-soft)"></span>非经营收益（流入）</div>
      {/if}
    </div>
    {#if model.notes.length}
      <div class="sankey-foot">
        {#each model.notes as n}<span class="n">·</span> {@html n} {/each}
      </div>
    {/if}
  </div>
{/if}
