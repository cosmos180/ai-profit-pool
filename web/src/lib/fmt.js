// Fmt —— 呈现层格式化，从 app.template.html 原样搬来（不含任何业务计算）。
// null-safe：一切 null 一路渲成 "—"（不变量 3），组件禁止 ?? 0 / || 0 把 null 伪造成值。
export const Fmt = {
  bn: (v, d = 1) => v == null ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + 'B',
  pct: (v, d = 1) => v == null ? '—' : (v * 100).toFixed(d) + '%',
  // 份额类·图内紧凑档（A4 统一规则）：图内空间紧时用整数百分比，但对非零小份额
  // 防「0% 归零误导」——(0, 0.5%) 一律显示「<1%」而非「0%」。null → 「—」（不伪造）。
  // 图例/表格仍用 Fmt.pct(v, 1)（1 位小数），全局仅此两档，避免同屏精度打架。
  pctCompact: (v) => {
    if (v == null) return '—'
    const p = v * 100
    if (p > 0 && p < 0.5) return '<1%'
    return Math.round(p) + '%'
  },
  mult: (v) => v == null ? '—' : v.toFixed(1) + '×',
  // n/m 封顶档：倍数超 cap（默认 200×）渲染 ">cap×"——分母利润过薄时倍数零信息量且挤占
  // 列宽，真值由 tooltip / 排序键承载。与 mult 同为纯呈现，不改任何 selector 语义。
  multCap: (v, cap = 200) => v == null ? '—' : (v > cap ? `>${cap}×` : v.toFixed(1) + '×'),
  // 封顶格的真值 tooltip（multCap 的配套）：封顶才非 undefined，未封顶格不挂 title。
  multCapTitle: (v, cap = 200) => (v != null && v > cap) ? `真值 ${v.toFixed(1)}× · 超 ${cap}× 展示封顶——分母过薄，倍数不具横比信息量` : undefined,
  yoy: (v) => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%',
  segLabel: (s) => ({ yes: '分部利润 · 可得', partial: '分部利润 · 部分', no: '分部利润 · 不可得' }[s] || '分部利润 · 未知'),
}
