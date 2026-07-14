// 轻量路由 store（ADR 决策 4）：等价于原 state 对象，用 Svelte 5 runes。
// 无 URL（功能对等阶段，深链留作后续 ADR）。承载 view/companyId/fy/homeMetric。
class Nav {
  view = $state('comps')       // 'home' | 'comps' | 'company' | 'detail' | 'analysis'；默认落地页=估值横截面（2026-07-14 用户拍板：最高频决策入口；home 经「公司对比」面包屑可达）
  companyId = $state(null)
  fy = $state(null)
  periodId = $state(null)
  homeMetric = $state('revenue')
  // 登记表报告镜头（口径，非指标）：'auto' = 组件按覆盖度自动选（默认 TTM，不足退最新季），
  // 或显式 'latestQuarter' | 'ttm' | 'calendarYear' | 'fiscalYear'。仅作用于登记表数值/角标区。
  reportLens = $state('auto')

  goHome() { this.companyId = null; this.fy = null; this.periodId = null; this.view = 'home'; scrollTop() }
  goComps() { this.companyId = null; this.fy = null; this.periodId = null; this.view = 'comps'; scrollTop() }
  goAnalysis() { this.companyId = null; this.fy = null; this.periodId = null; this.view = 'analysis'; scrollTop() }
  goCompany(id) { this.companyId = id; this.fy = null; this.periodId = null; this.view = 'company'; scrollTop() }
  goDetail(id, fy) { this.companyId = id; this.fy = fy; this.periodId = null; this.view = 'detail'; scrollTop() }
  goPeriod(id, periodId) { this.companyId = id; this.fy = null; this.periodId = periodId; this.view = 'detail'; scrollTop() }
  setHomeMetric(m) { this.homeMetric = m }
  setReportLens(l) { this.reportLens = l }
}

function scrollTop() {
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' })
}

export const nav = new Nav()
