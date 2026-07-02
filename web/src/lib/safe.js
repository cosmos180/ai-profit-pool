// Safe —— 转义/白名单，从 app.template.html 原样搬来。
// Svelte 的 {expr} 已对文本/属性自动转义，故 Safe.text/attr 在组件里大多退役；
// 保留 Safe.cls（动态 class 白名单，供 chain_stage / seg_profit 等拼 class 用）
// 与 Safe.url（URL 白名单：非 http(s) → '#'，不变量 2 provenance 呈现用）。
export const Safe = {
  text(v) { return v == null ? '' : String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch])) },
  attr(v) { return Safe.text(v) },
  cls(v) { return String(v || '').replace(/[^a-z0-9_-]/gi, '') },
  url(v) { const s = String(v || '').trim(); return /^https?:\/\//i.test(s) ? s : '#' },
}
