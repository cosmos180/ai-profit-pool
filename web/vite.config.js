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

// 采纳 dist + copy 方案（ADR 决策 6/7）：输出到 web/dist/，绝不用 outDir:'..'+emptyOutDir。
// 迁移并行期不覆盖仓库根 app.html；package.json build 末尾 cp dist/index.html dist/app.html 供比对。
export default defineConfig({
  plugins: [svelte(), inlineDataset(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,          // 只清 web/dist/，安全（不是仓库根）
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
})
