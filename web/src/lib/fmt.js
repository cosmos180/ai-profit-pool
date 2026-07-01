// Fmt —— 呈现层格式化，从 app.template.html 原样搬来（不含任何业务计算）。
// null-safe：一切 null 一路渲成 "—"（不变量 3），组件禁止 ?? 0 / || 0 把 null 伪造成值。
export const Fmt = {
  bn: (v, d = 1) => v == null ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + 'B',
  pct: (v, d = 1) => v == null ? '—' : (v * 100).toFixed(d) + '%',
  mult: (v) => v == null ? '—' : v.toFixed(1) + '×',
  yoy: (v) => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%',
  segLabel: (s) => ({ yes: '分部利润 · 可得', partial: '分部利润 · 部分', no: '分部利润 · 不可得' }[s] || '分部利润 · 未知'),
}
