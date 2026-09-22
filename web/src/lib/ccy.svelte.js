// ccy —— 显示币种的全局唯一口径（呈现层）。
// 之前版本靠 Company/Detail 各自闭包 + prop 层层下传，靠纪律不靠结构：新组件忘接 prop
// 就静默回退 USD。本模块把口径收敛成结构——任何组件 import { money } 即获得正确口径，
// 不存在"忘记接线"的失败模式。
//
// 契约（与 Selectors.toSrc 一致，失败关闭）：
//   mode='usd'（默认） → 一律 Fmt.bn（库内统一 USD 口径，跨公司可比）；
//   mode='src'         → carrier 是该金额的数据期（period/annual），按该期入账汇率
//                         （carrier.fx_to_usd）精确还原原币——与官方 filing 逐位一致；
//                         carrier 缺失/币种为 USD/无 fx → 回退 USD，绝不拿错期汇率硬折。
// 还原用该期入账汇率而非查看当日汇率：当日汇率会让历史数随今天的价漂移、与官方
// filing 对不上。会话级状态（跨页面保留，不入 URL）。
import { Fmt } from './fmt.js'

class DisplayCcy {
  mode = $state('usd')   // 'usd' | 'src'
  set(x) { this.mode = x }
}

export const ccy = new DisplayCcy()

export function money(v, carrier, d = 1) {
  if (ccy.mode === 'src' && v != null && carrier
      && carrier.currency && carrier.currency !== 'USD' && carrier.fx_to_usd > 0) {
    return Fmt.local(v * carrier.fx_to_usd, carrier.currency, d)
  }
  return Fmt.bn(v, d)
}
