<script>
  // 显示币种切换（公司页 + 报告期/财年下钻页共用）。USD 报表公司不渲染（库内即原币）。
  // 口径实现收敛在 lib/ccy（money/mode）；本组件只管可见性与切换读写。
  import { Selectors } from '../lib/data.js'
  import { ccy } from '../lib/ccy.svelte.js'

  let { company } = $props()

  const srcCcy = $derived(company ? Selectors.srcCcyOf(company) : null)
</script>

{#if srcCcy}
  <div class="ccy-toggle" role="group" aria-label="显示币种">
    <span class="ct-lbl">显示币种</span>
    <button class="ct-chip" class:on={ccy.mode !== 'src'} onclick={() => ccy.set('usd')}
      title="库内统一 USD 口径（按各期入账汇率折算），跨公司可比">USD</button>
    <button class="ct-chip" class:on={ccy.mode === 'src'} onclick={() => ccy.set('src')}
      title="{srcCcy} 报告币种：按各期财报原币精确还原（该期入账汇率 ×），与官方 filing 逐位一致；同比亦按原币计算（去汇率影响）。预测年与估值卡仍为 USD。">{srcCcy} 报告币种</button>
  </div>
{/if}
