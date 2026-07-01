<script>
  // 数据来源块（原 sourcesBlock）：每条 source 的 label + data_status 标签 + url 经 Safe.url。
  // 不变量2：url 白名单（非 http(s) → '#'），不编造。
  import { Safe } from '../lib/safe.js'

  let { year } = $props()

  const rows = $derived((year?.sources || []).map(s => ({
    label: s.label,
    status: s.data_status || '',
    url: Safe.url(s.url),
  })))
</script>

<div class="section-h">数据来源</div>
<div class="card srcs">
  {#each rows as s}
    <div class="srcrow"><span class="sl">{s.label}<span class="tagx" style="margin-left:8px">{s.status}</span></span><a href={s.url} target="_blank" rel="noopener">来源 ↗</a></div>
  {/each}
</div>
