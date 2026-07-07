// 轻量路由 store（ADR 决策 4）：等价于原 state 对象，用 Svelte 5 runes。
// 无 URL（功能对等阶段，深链留作后续 ADR）。承载 view/companyId/fy/homeMetric。
class Nav {
  view = $state('home')        // 'home' | 'company' | 'detail'
  companyId = $state(null)
  fy = $state(null)
  homeMetric = $state('revenue')
  // 登记表报告镜头（口径，非指标）：'auto' = 组件按覆盖度自动选（默认 TTM，不足退最新季），
  // 或显式 'latestQuarter' | 'ttm' | 'calendarYear' | 'fiscalYear'。仅作用于登记表数值/角标区。
  reportLens = $state('auto')

  goHome() { this.companyId = null; this.fy = null; this.view = 'home'; scrollTop() }
  goCompany(id) { this.companyId = id; this.fy = null; this.view = 'company'; scrollTop() }
  goDetail(id, fy) { this.companyId = id; this.fy = fy; this.view = 'detail'; scrollTop() }
  setHomeMetric(m) { this.homeMetric = m }
  setReportLens(l) { this.reportLens = l }
}

function scrollTop() {
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' })
}

export const nav = new Nav()
