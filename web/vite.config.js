import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 构建期把根 companies.json 内联进 index.html 的 dataset 占位符（ADR 决策 6）。
// 单一真相源仍是根 companies.json；这里只做注入，不改写、不校验（校验归 prebuild 的 validate.py）。
// Store.load() 会读 <script id="dataset"> 命中内联分支，file:// 双击可用（不触发 fetch）。
function inlineDataset() {
  return {
    name: 'inline-dataset',
    // enforce:'pre' + transformIndexHtml：在 singlefile 内联前先把数据塞进占位符。
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const data = readFileSync(resolve(__dirname, '../companies.json'), 'utf-8').trim()
        if (!html.includes('<!--__DATASET_JSON__-->')) {
          throw new Error('inlineDataset: dataset 占位符 <!--__DATASET_JSON__--> 未找到，index.html 被改坏了')
        }
        return html.replace('<!--__DATASET_JSON__-->', () => data)
      },
    },
  }
}

// data-module.js 是纯 CJS（module.exports），且必须保持 CJS —— 老 build.py 把它当经典
// <script> 内联进 app.template.html，写 `export` 会让老页 SyntaxError（迁移并行期老页要能用）。
// 但 dev 模式下 Vite 按原生 ESM 提供它、找不到导出 → 整页白屏（build 时 esbuild/Rollup 会
// 合成 default，故 build 正常、dev 挂）。此插件在 transform 期给它「追加」ESM 具名导出：
// 源文件一字不改（CJS/经典脚本路径不受影响），dev 与 build 都拿到真正的具名导出。
// 尾部 `module.exports` 在 ESM 下因 `typeof module!=="undefined"` 守卫为假而被跳过，安全。
function esmDataModule() {
  const EXPORTS = 'Store, Selectors, STAGE_OF_FALLBACK, STAGE_ORDER, STAGE_LABEL, STAGE_COLOR, stageOf, _refreshStages'
  return {
    name: 'esm-data-module',
    transform(code, id) {
      if (id.replace(/\?.*$/, '').endsWith('/data-module.js')) {
        // 剥掉 ESM 下的死代码 CJS 尾（`module.exports = …`，被 typeof 守卫恒假），
        // 换成真正的具名导出——顺带消除 Rollup 的 COMMONJS_VARIABLE_IN_ESM 警告。
        const esm = code.replace(/^.*\bmodule\.exports\b.*$/m, '')
        return { code: `${esm}\nexport { ${EXPORTS} };\n`, map: null }
      }
    },
  }
}

// 采纳 dist + copy 方案（ADR 决策 6/7）：输出到 web/dist/，绝不用 outDir:'..'+emptyOutDir。
// 迁移并行期不覆盖仓库根 app.html；package.json build 末尾 cp dist/index.html dist/app.html 供比对。
export default defineConfig({
  plugins: [svelte(), esmDataModule(), inlineDataset(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,          // 只清 web/dist/，安全（不是仓库根）
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
})
