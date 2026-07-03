// 纯呈现常量，从 app.template.html 搬来（标签/格式映射/方向提示——非业务算术）。
import { Fmt } from './fmt.js'

export const HOME_METRIC_LABEL = {
  revenue: '营收', netIncome: '净利润', netM: '净利率', fcfMargin: 'FCF 利润率',
  capexInt: 'capex 强度', pe: 'PE', ps: 'PS', evSales: 'EV/Sales', fcfYield: 'FCF yield',
}

export const HOME_METRIC_FMT = {
  revenue: v => Fmt.bn(v, 1), netIncome: v => Fmt.bn(v, 1), netM: v => Fmt.pct(v),
  fcfMargin: v => Fmt.pct(v), capexInt: v => Fmt.pct(v), pe: v => Fmt.mult(v),
  ps: v => Fmt.mult(v), evSales: v => Fmt.mult(v), fcfYield: v => Fmt.pct(v),
}

// 越低越便宜的估值指标：列表降序排列，需提示"排第一≠最便宜"。
export const HOME_METRIC_LOWER_CHEAPER = { pe: true, ps: true, evSales: true }
