<script>
  // 估值 vs 增长（原 renderEvVsGrowth）：PEG 近似 = PE 与净利同比并置，不造合成比值。
  // 降级：pe caveat==='na'（软银）→ 整块不适用；niYoY 为 null 且 ≥2 实际年 → 周期反转不可比；
  // <2 实际年 → —。业务数据全来自 Selectors，组件内无财务算术。
  import { Selectors } from '../lib/data.js'
  import { Fmt } from '../lib/fmt.js'

  // caveatShown：上方估值卡组是否已展示共享口径说明（软银）。为真则本块不再复制完整 note，
  // 只保留本块特有的一句降级理由（诚实标注不丢，全文见上方「口径说明」）。
  let { company, caveatShown = false } = $props()

  const note = $derived(company?.valuation_caveat?.note || '')
  const peNa = $derived(Selectors.valuationCaveat(company, 'pe') === 'na')

  const pe = $derived(Selectors.pe(company))
  const g = $derived(Selectors.niYoY(company))
  const nAct = $derived(Selectors.actualYears(company).length)

  // 增长侧呈现三态（值 / 周期反转不可比 / 样本不足）——纯呈现分流，无计算。
  const growth = $derived.by(() => {
    if (g != null) return { val: Fmt.yoy(g), cls: g >= 0 ? 'up' : 'dn', sub: '最新实际年 净利润 较上一实际年' }
    if (nAct >= 2) return { val: '不可比', cls: 'na', sub: '上一实际年净利≤0（周期反转），基期无意义' }
    return { val: '—', cls: 'na', sub: '不足两个实际年，无同比基期' }
  })
  const peVal = $derived(pe != null ? Fmt.mult(pe) : '—')
</script>

{#if peNa}
  <div class="evg evg-na">
    <div class="evg-h">估值 vs 增长 <span class="evg-flag na">不适用</span></div>
    <p class="evg-note">该公司净利润含投资公允价值损益（非经营），PE 已留空、净利同比无经营含义，<b>"贵得有没有道理"无法用 PE/增长判断</b>，诚实降级。{#if !caveatShown}{note}{/if}</p>
  </div>
{:else}
  <div class="evg">
    <div class="evg-h">估值 vs 增长 <span class="evg-tag">PEG 近似 · 并置不合成</span></div>
    <div class="evg-pair">
      <div class="evg-cell"><div class="evg-l">估值 · PE</div><div class="evg-v num">{peVal}</div><div class="evg-s">市值 / 最新实际年净利润</div></div>
      <div class="evg-vs">对</div>
      <div class="evg-cell"><div class="evg-l">增长 · 净利同比</div><div class="evg-v num {growth.cls}">{growth.val}</div><div class="evg-s">{growth.sub}</div></div>
    </div>
    <p class="evg-note">PE 高但增长快，与高而不长，一眼并看判断"贵得有没有道理"。<b>净利同比为历史口径（已实现财年），非远期卖方一致预期</b>，不可直接当 PEG 分母。</p>
  </div>
{/if}
