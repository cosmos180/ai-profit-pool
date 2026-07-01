<script>
  // 占位组件（本轮只做 Home 对等；Detail 切片后续任务落地）。
  import { nav } from '../lib/nav.svelte.js'
</script>

<div class="dhead">
  <span class="dfy">{nav.fy ?? ''}</span>
</div>
<div class="note-block">
  财年下钻页尚在迁移中（本轮交付范围为 Home 切片）。
  <button class="crumb" style="margin-top:8px;color:var(--ok)" onclick={() => nav.goHome()}>← 返回公司对比</button>
</div>
