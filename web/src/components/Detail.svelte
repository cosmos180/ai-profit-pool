<script>
  // 财年下钻页（原 goDetail/renderDetail + actualView/forecastView）。
  // 三态分流用 Selectors.hasSegmentProfit + c.seg_profit；对账/桑基/来源分别托子组件。
  // 业务数据全来自 Selectors，组件内无财务算术（share/yoy/margin 皆 Selector 派生）。
  import { nav } from '../lib/nav.svelte.js'
  import { Store, Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'
  import Sankey from '../charts/Sankey.svelte'
  import Reconcile from './Reconcile.svelte'
  import SourcesBlock from './SourcesBlock.svelte'

  const c = $derived(nav.companyId ? Store.byId(nav.companyId) : null)
  const y = $derived(c && nav.fy ? Selectors.yearByFy(c, nav.fy) : null)
  const isForecast = $derived(y?.status === 'forecast')

  const firstWord = s => (s || '').split(' ')[0]

  // —— actual：营收板块（降序）——
  const platRows = $derived.by(() => {
    if (!y || isForecast) return []
    const sorted = Selectors.revenueSorted(y)
    const maxV = sorted[0] ? sorted[0].revenue : 1
    return sorted.map(p => {
      const yoy = Selectors.segYoY(c, y.fy, p.name)
      return {
        name: p.name, is_ai: p.is_ai,
        revLabel: Fmt.bn(p.revenue, 2),
        shareLabel: Fmt.pct(Selectors.segRevShare(y, p.name), 1),  // 占分部合计比（Selector 派生，null 透传）
        barW: (p.revenue / maxV * 100).toFixed(1),  // 布局宽度百分比（非财务量）
        yoy,
      }
    })
  })

  // —— actual：公司层面现金格（仅当有 capex/cfo）——
  const showCash = $derived(!!(y && !isForecast && (y.capex != null || y.cfo != null)))
  const cashFcf = $derived(showCash ? Selectors.fcf(y) : null)

  // —— actual：对账 ——
  const rec = $derived(y && !isForecast ? Selectors.reconcile(y) : null)

  // —— actual：利润块三态 ——
  const profitState = $derived.by(() => {
    if (!y || isForecast) return null
    if (Selectors.hasSegmentProfit(y)) return 'table'
    if (c.seg_profit === 'yes') return 'unentered'
    return 'gap'
  })
  const profitRows = $derived.by(() => {
    if (profitState !== 'table') return []
    const ps = Selectors.profitSorted(y)
    const pmax = ps[0] ? ps[0].op_income : 1
    return ps.map(p => {
      return {
        name: p.name, is_ai: p.is_ai,
        opLabel: Fmt.bn(p.op_income, 2),
        marginLabel: Fmt.pct(Selectors.segOpMargin(p)),
        barW: (p.op_income / pmax * 100).toFixed(1),  // 布局宽度（非财务量）
      }
    })
  })
  // structural gap 的 reportable_note 展示项
  const gapSegs = $derived.by(() => {
    if (profitState !== 'gap') return []
    const rn = y.reportable_note || {}
    return Object.entries(rn).map(([k, v]) => ({ name: k, value: v }))
  })

  // —— forecast：锚点 ——
  const anchors = $derived.by(() => {
    if (!y || !isForecast) return []
    const arr = y.anchors || []
    return arr.map((a, i) => ({ ...a, big: i === arr.length - 1 }))
  })
</script>

{#if !c || !y}
  <div class="dhead"><span class="dfy">{nav.fy ?? ''}</span></div>
  <div class="note-block">未找到对应公司或财年。
    <button class="crumb" style="margin-top:8px;color:var(--ok)" onclick={() => nav.goHome()}>← 返回公司对比</button>
  </div>
{:else}
  <div class="dhead">
    <span class="dfy">{c.name} · {y.fy}</span>
    <span class="dperiod">{y.period_end || ''}</span>
    {#if isForecast}
      <span class="dbadge ybadge fc">预测 · 卖方一致预期</span>
    {:else}
      <span class="dbadge ybadge act">实际 · GAAP</span>
    {/if}
  </div>

  {#if isForecast}
    <!-- ============ 预测年 ============ -->
    <div class="section-h" style="margin-top:18px">本财年 · 预测（非实际）</div>
    <div class="note-block" style="margin-top:0"><b>这是预测，不是已实现的经营事实。</b>全年一致预期约 {Fmt.bn(y.revenue, 0)}{#if y.consensus_rev}（区间 {y.consensus_rev}）{/if}{#if y.consensus_eps}，一致预期 EPS 约 {y.consensus_eps}{/if}。下方锚点按可靠度分别标注。</div>
    <div class="section-h">预测锚点</div>
    <div class="fcgrid">
      {#each anchors as a}
        <div class="card fcc {a.big ? 'big' : ''}"><div class="fl">{a.label}</div><div class="fv num">{a.value}</div><div class="fs">{a.note || ''}</div></div>
      {/each}
    </div>
    {#if y.framework_change}
      <div class="section-h">板块口径 · 重要变化</div>
      <div class="gap"><h3>本财年起板块划分有变</h3><p>{y.framework_change}</p></div>
    {/if}
    <SourcesBlock year={y} />
  {:else}
    <!-- ============ 实际年 ============ -->
    <div class="section-h" style="margin-top:18px">公司层面 · {y.fy}</div>
    <div class="card csum">
      <div class="c"><div class="cl">营收</div><div class="cv num">{Fmt.bn(y.revenue, 1)}</div></div>
      <div class="c">
        <div class="cl">毛利率{#if y.gross_margin == null}<span class="cl-flag" title="该公司未在此财年披露公司层面毛利率——诚实留空，而非缺数据">未披露</span>{/if}</div>
        <div class="cv num">{Fmt.pct(y.gross_margin)}</div>
      </div>
      <div class="c"><div class="cl">经营利润率</div><div class="cv num">{Fmt.pct(Selectors.opMargin(y))}</div></div>
      <div class="c"><div class="cl">净利润</div><div class="cv num green">{Fmt.bn(y.net_income, 1)}</div></div>
      <div class="c"><div class="cl">净利率</div><div class="cv num green">{Fmt.pct(Selectors.netMargin(y))}</div></div>
      {#if showCash}
        <div class="c"><div class="cl">capex 强度</div><div class="cv num">{Fmt.pct(Selectors.capexIntensity(y))}</div></div>
        <div class="c"><div class="cl">自由现金流</div><div class="cv num {cashFcf != null && cashFcf >= 0 ? 'green' : ''}">{Fmt.bn(cashFcf, 1)}</div></div>
        <div class="c"><div class="cl">现金转化率</div><div class="cv num">{Fmt.pct(Selectors.cashConversion(y))}</div></div>
      {/if}
    </div>

    <Sankey company={c} year={y} />

    <div class="section-h">业务板块营收 · 降序</div>
    <div class="card">
      <div class="plat">
        {#each platRows as p (p.name)}
          <div class="platrow {p.is_ai ? 'ai' : ''}">
            <div class="pt">
              <span class="pname">{p.name}{#if p.is_ai}<span class="aitag">AI 主战场</span>{/if}</span>
              <span class="pv num">{p.revLabel}<span class="sh">{p.shareLabel}</span></span>
            </div>
            <div class="ptrack"><div class="pfill" style="width:{p.barW}%"></div></div>
            <div class="pyoy">
              {#if p.yoy == null}<span class="na" title="这是本公司已录入的最早财年，没有上一年同分部数据作基期，故无法算同比——属数据边界，不是缺失">同比 n/a · 最早财年无基期</span>{:else}<span class={p.yoy >= 0 ? 'up' : 'dn'}>同比 {Fmt.yoy(p.yoy)}</span>{/if}
            </div>
          </div>
        {/each}
      </div>
      {#if rec}<Reconcile {rec} />{/if}
    </div>

    <!-- 利润块三态 -->
    {#if profitState === 'table'}
      <div class="section-h">业务板块利润与利润率 · 降序</div>
      <div class="card">
        <div class="plat">
          {#each profitRows as p (p.name)}
            <div class="platrow {p.is_ai ? 'ai' : ''}">
              <div class="pt">
                <span class="pname">{p.name}{#if p.is_ai}<span class="aitag">AI 主战场</span>{/if}</span>
                <span class="pv num">{p.opLabel}<span class="sh">利润率 {p.marginLabel}</span></span>
              </div>
              <div class="ptrack"><div class="pfill" style="width:{p.barW}%"></div></div>
            </div>
          {/each}
        </div>
        <div class="recon-line">看点：<b>营收最大的不是利润最大的</b> —— 正是"只看营收会误判"的实证。</div>
      </div>
    {:else if profitState === 'unentered'}
      <div class="section-h">业务板块利润与利润率</div>
      <div class="gap"><h3>该公司按部门披露营业利润，本财年暂未录入</h3>
        <p>{firstWord(c.name)} 标记 <code style="font-family:var(--mono)">seg_profit:"yes"</code> —— 分部营业利润是<b>可得</b>的，只是此财年还没录进 <code style="font-family:var(--mono)">companies.json</code>。切到已录入的财年即可看到完整的利润/利润率表。这是"数据待补录"，不同于下面那种"公司根本不披露"。</p>
      </div>
    {:else if profitState === 'gap'}
      <div class="section-h">利润 / 毛利率 · 数据缺口（真实约束）</div>
      <div class="gap"><h3>{firstWord(c.name)} 不把利润拆到上面的市场平台</h3>
        <p>公司只把经营利润披露到报告分部，且<b>不披露各平台毛利率</b>。所以"每个板块利润、毛利率降序"对它在公开财报里只能到营收级 —— 这就是 <code style="font-family:var(--mono)">seg_profit:"{c.seg_profit}"</code> 的含义，在真实数据里的样子：</p>
        <div class="seg2">
          {#each gapSegs as sg (sg.name)}
            <div class="seg"><div class="sn">{sg.name}</div><div class="sv num">{sg.value}</div><div class="sl">占营收 · 报告分部</div></div>
          {/each}
        </div>
        <div class="locked"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" style="flex:none"><rect x="5" y="11" width="14" height="9" rx="2" stroke="#8a5a0f" stroke-width="1.8" /><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="#8a5a0f" stroke-width="1.8" /></svg>
          <span><b>平台级毛利率 / 净利润：未披露。</b>诚实做法是留空并标注，而不是估一个数填进去。</span></div>
      </div>
    {/if}

    <SourcesBlock year={y} />
  {/if}
{/if}
