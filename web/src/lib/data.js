// ESM 适配壳（ADR 决策 2 / 校验点 1）——唯一允许 import 业务模块的地方。
// 组件一律从这里拿 Store/Selectors/STAGE_*，禁止组件直接 import '../../data-module.js'。
// data-module.js 保持纯 CJS 不动；Vite/esbuild 把它的 module.exports 映射为默认导入。
import mod from '../../../data-module.js'

// interop 兜底：若 esbuild 的 default-interop 把命名导出直接摊平（default 上拿不到），
// 用 mod 本身兜底。语义不变，仍是"一份 data-module + 一层壳"。
const M = (mod && mod.Store) ? mod : mod?.default ?? mod

export const {
  Store,
  Selectors,
  STAGE_OF_FALLBACK,
  STAGE_ORDER,
  STAGE_LABEL,
  STAGE_COLOR,
  stageOf,
  _refreshStages,
} = M

// 最小断言（ADR 校验点 1）：interop 正常时 Selectors.pe 必须是函数，否则壳没接通。
if (typeof Selectors?.pe !== 'function') {
  throw new Error('lib/data.js: CJS→ESM interop 失败，未从 data-module.js 取到 Selectors.pe')
}
// Home hero 的两个组合派生（龙头占比 / 利润池同比）已下沉为 data-module.js 的
// Selectors.profitPoolLeader / profitPoolYoY —— 与其余派生同处唯一真相边界（不变量5）。
// 组件从 Selectors 直接取,本层不再重复业务算术。
