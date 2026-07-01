<script>
  // 占位组件（本轮只做 Home 对等；Company 切片后续任务落地）。
  // 点进去不崩：读 nav + Store 拿公司名，给个占位卡片，可经面包屑回跳。
  import { nav } from '../lib/nav.svelte.js'
  import { Store } from '../lib/data.js'

  const company = $derived(nav.companyId ? Store.byId(nav.companyId) : null)
</script>

<h1 class="title">{company ? company.name : '公司不存在'}</h1>
<div class="note-block">
  公司页尚在迁移中（本轮交付范围为 Home 切片）。
  {#if company}此处将呈现 KPI、趋势、现金、估值、按财年下钻。{/if}
  <button class="crumb" style="margin-top:8px;color:var(--ok)" onclick={() => nav.goHome()}>← 返回公司对比</button>
</div>
