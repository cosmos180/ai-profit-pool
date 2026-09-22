// 轻量路由 store（ADR 决策 4 基础上升级）：内存状态 + hash 深链双向同步。
// 路由表（唯一真相：hashOf/_apply 成对互逆）：
//   #/comps                     估值横截面（默认落地页）
//   #/home                      公司对比
//   #/analysis                  高级分析
//   #/c/<id>                    公司页
//   #/c/<id>/fy/<fy>            财年下钻
//   #/c/<id>/p/<periodId>       报告期下钻
// 排序/镜头/币种等会话级 UI 状态不入 URL（深链只锚定位置，不锚定临时视图参数）。
// 浏览器前进/后退经 hashchange 事件回放（_syncing 防自激振荡）。
class Nav {
  view = $state('comps')       // 'home' | 'comps' | 'company' | 'detail' | 'analysis'；默认落地页=估值横截面（2026-07-14 用户拍板：最高频决策入口；home 经「公司对比」面包屑可达）
  companyId = $state(null)
  fy = $state(null)
  periodId = $state(null)
  homeMetric = $state('revenue')
  // 登记表报告镜头（口径，非指标）：'auto' = 组件按覆盖度自动选（默认 TTM，不足退最新季），
  // 或显式 'latestQuarter' | 'ttm' | 'calendarYear' | 'fiscalYear'。仅作用于登记表数值/角标区。
  reportLens = $state('auto')
  // 显示币种（公司页）：'usd' = 库内统一 USD 口径（默认，跨公司可比）；
  // 'src' = 报告币种（按各期财报原币精确还原，仅非 USD 报表公司提供切换）。跨页面保留。
  ccy = $state('usd')

  goHome()    { this.companyId = null; this.fy = null; this.periodId = null; this.view = 'home'; this._writeHash(); scrollTop() }
  goComps()   { this.companyId = null; this.fy = null; this.periodId = null; this.view = 'comps'; this._writeHash(); scrollTop() }
  goAnalysis(){ this.companyId = null; this.fy = null; this.periodId = null; this.view = 'analysis'; this._writeHash(); scrollTop() }
  goCompany(id) { this.companyId = id; this.fy = null; this.periodId = null; this.view = 'company'; this._writeHash(); scrollTop() }
  goDetail(id, fy) { this.companyId = id; this.fy = fy; this.periodId = null; this.view = 'detail'; this._writeHash(); scrollTop() }
  goPeriod(id, periodId) { this.companyId = id; this.fy = null; this.periodId = periodId; this.view = 'detail'; this._writeHash(); scrollTop() }
  setHomeMetric(m) { this.homeMetric = m }
  setReportLens(l) { this.reportLens = l }
  setCcy(x) { this.ccy = x }

  // —— hash 同步（浏览器侧；SSR/测试无 window 时静默跳过）——
  _writeHash() {
    if (typeof window === 'undefined' || this._syncing) return
    const h = this._hashOf()
    if (('#' + h) !== window.location.hash) window.location.hash = h   // 变化才写 → 不产生冗余历史项
  }
  _hashOf() {
    if (this.view === 'comps' || this.view === 'home' || this.view === 'analysis') return '/' + this.view
    if (this.view === 'company' && this.companyId) return `/c/${this.companyId}`
    if (this.view === 'detail' && this.companyId) {
      if (this.periodId) return `/c/${this.companyId}/p/${this.periodId}`
      if (this.fy) return `/c/${this.companyId}/fy/${this.fy}`
      return `/c/${this.companyId}`
    }
    return '/comps'
  }
  _applyHash(hash) {
    const m = (hash || '').replace(/^#/, '').replace(/^\/?/, '/')
    let seg = m.split('/').filter(Boolean)
    this.companyId = null; this.fy = null; this.periodId = null
    if (seg[0] === 'home') { this.view = 'home'; return }
    if (seg[0] === 'analysis') { this.view = 'analysis'; return }
    if (seg[0] === 'c' && seg[1]) {
      this.companyId = decodeURIComponent(seg[1])
      if (seg[2] === 'fy' && seg[3]) { this.view = 'detail'; this.fy = decodeURIComponent(seg[3]); return }
      if (seg[2] === 'p' && seg[3])  { this.view = 'detail'; this.periodId = decodeURIComponent(seg[3]); return }
      this.view = 'company'; return
    }
    this.view = 'comps'   // 未知/空 hash → 默认落地页
  }
}

function scrollTop() {
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' })
}

export const nav = new Nav()

// —— 浏览器侧接线：初始深链 + 前进/后退回放 ——
if (typeof window !== 'undefined') {
  nav._applyHash(window.location.hash)
  window.addEventListener('hashchange', () => {
    nav._syncing = true
    try { nav._applyHash(window.location.hash) } finally { nav._syncing = false }
  })
}
