import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 数据分片组装（JS 侧，与 tools/assemble.py 同契约）：真相源 = data/meta.json 的
// company_order + data/companies/<id>.json。根 companies.json 是 gitignore 的构建产物，
// dev 与 build 都从这里组装，不依赖产物存在。
function loadDataset() {
  const dataDir = resolve(__dirname, '../data')
  const meta = JSON.parse(readFileSync(resolve(dataDir, 'meta.json'), 'utf-8'))
  const order = meta.company_order
  if (!Array.isArray(order) || !order.length) throw new Error('vite: data/meta.json 缺 company_order')
  const files = new Set(readdirSync(resolve(dataDir, 'companies')).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')))
  const missing = order.filter(id => !files.has(id)), extra = [...files].filter(id => !order.includes(id))
  if (missing.length || extra.length) throw new Error(`vite: company_order 与 data/companies 不一致 缺[${missing}] 多[${extra}]`)
  return {
    meta,
    companies: order.map(id => JSON.parse(readFileSync(resolve(dataDir, 'companies', id + '.json'), 'utf-8'))),
  }
}

// 构建水印（评审 #6）：单文件 app.html 会被转发，页脚亮明「数据截至 X · 行情 Y · commit」
// 让每个流转副本可溯源。数据时点取库内最大 actual period_end 与最大 quote.as_of；
// commit 取 git short hash（无 git 环境静默降级为空，不阻塞构建）。
function buildStamp() {
  let commit = ''
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch { /* 无 git 环境 */ }
  let dataAsOf = '', quoteAsOf = ''
  try {
    const db = loadDataset()
    const dates = []
    for (const c of db.companies || []) {
      for (const p of c.periods || []) if (p.status === 'actual' && p.period_end) dates.push(p.period_end)
      if (c.quote && c.quote.as_of && String(c.quote.as_of) > quoteAsOf) quoteAsOf = String(c.quote.as_of)
    }
    dates.sort()
    dataAsOf = dates[dates.length - 1] || ''
  } catch { /* 数据缺失时水印只带 commit */ }
  return `数据截至 ${dataAsOf || '—'}${quoteAsOf ? ` · 行情 ${quoteAsOf}` : ''}${commit ? ` · ${commit}` : ''}`
}

// 构建期把组装后的数据集内联进 index.html 的 dataset 占位符（ADR 决策 6）。
// 单一真相源是 data/ 分片（见 loadDataset）；这里只做注入，不改写、不校验（校验归 prebuild 的 validate.py）。
// Store.load() 会读 <script id="dataset"> 命中内联分支，file:// 双击可用（不触发 fetch）。
function inlineDataset() {
  return {
    name: 'inline-dataset',
    // enforce:'pre' + transformIndexHtml：在 singlefile 内联前先把数据塞进占位符。
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const data = JSON.stringify(loadDataset()).trim()
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
  return {
    name: 'esm-data-module',
    transform(code, id) {
      if (id.replace(/\?.*$/, '').endsWith('/data-module.js')) {
        // A5：从 `module.exports = { ... }` 那一行【正则自动提取】导出名，不再硬编码——
        // data-module.js 新增导出时 dev 不再静默丢失（旧硬编码 EXPORTS 是债3）。
        const m = code.match(/\bmodule\.exports\s*=\s*\{([^}]*)\}/)
        if (!m) {
          throw new Error('esmDataModule: 未在 data-module.js 找到 `module.exports = { ... }` 导出行，无法自动提取导出名')
        }
        const EXPORTS = m[1]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .join(', ')
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
  define: { __BUILD_STAMP__: JSON.stringify(buildStamp()) },
  plugins: [svelte(), esmDataModule(), inlineDataset(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,          // 只清 web/dist/，安全（不是仓库根）
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
})
