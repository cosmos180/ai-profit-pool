// ESM 适配壳（ADR 决策 2 / 校验点 1）——唯一允许 import 业务模块的地方。
// 组件一律从这里拿 Store/Selectors/STAGE_*，禁止组件直接 import '../../data-module.js'。
// data-module.js 保持纯 CJS 不动；vite.config 的 esmDataModule 插件在 transform 期给它
// 追加 ESM 具名导出，故 dev 与 build 都能直接具名 import（不再依赖 default-interop）。
import {
  Store,
  Selectors,
  STAGE_OF_FALLBACK,
  STAGE_ORDER,
  STAGE_LABEL,
  STAGE_COLOR,
  stageOf,
  _refreshStages,
} from '../../../data-module.js'

// 最小断言（ADR 校验点 1）：接通正常时 Selectors.pe 必须是函数，否则壳没接通。
if (typeof Selectors?.pe !== 'function') {
  throw new Error('lib/data.js: 未从 data-module.js 取到 Selectors.pe（esmDataModule 插件是否生效？）')
}

export {
  Store,
  Selectors,
  STAGE_OF_FALLBACK,
  STAGE_ORDER,
  STAGE_LABEL,
  STAGE_COLOR,
  stageOf,
  _refreshStages,
}
// Home hero 的两个组合派生（龙头占比 / 利润池同比）已下沉为 data-module.js 的
// Selectors.profitPoolLeader / profitPoolYoY —— 与其余派生同处唯一真相边界（不变量5）。
// 组件从 Selectors 直接取,本层不再重复业务算术。
