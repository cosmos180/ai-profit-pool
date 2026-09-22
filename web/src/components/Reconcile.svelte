<script>
  // 对账呈现（原 actualView 内 reconLine）：只呈现 Selectors.reconcile(y) 的结果。
  // platform 强制 sum==revenue（ok/差额）；division 不强制（差额=内部交易抵销，正常）。
  // 组件内无对账算术，全在 Selectors。diff 的 toFixed 是显示格式化（非业务计算）。
  // money(v, d)：金额格式化注入（报告币种模式由 Detail 传入；默认 USD 的 Fmt.bn）。
  import { Fmt } from '../lib/fmt.js'

  let { rec, money = null } = $props()
  const mn = (v, d = 2) => (money ? money(v, d) : Fmt.bn(v, d))
</script>

<div class="recon-line">
  {#if rec.partition}
    平台合计 {mn(rec.sum, 2)} {#if rec.ok}<span class="ok">＝</span>{:else}≠{/if} 公司总营收 {mn(rec.revenue, 2)} {#if rec.ok}<span class="ok">✓ 对账通过</span>{:else}（差 {money ? mn(rec.diff, 2) : rec.diff.toFixed(2)}）{/if}
  {:else}
    分部合计 {mn(rec.sum, 2)} &gt; 合并营收 {mn(rec.revenue, 2)}（差额 {mn(rec.diff, 2)} 为内部交易抵销，<span class="ok">正常</span>）
  {/if}
</div>
