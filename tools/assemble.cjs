#!/usr/bin/env node
// assemble.cjs — 数据分片的 Node 侧组装器（与 tools/assemble.py 同一契约）。
// 供 CJS 测试脚本（test-snapshot.js / gap-report.cjs）与构建期消费：
// 真相源 = data/meta.json 的 company_order + data/companies/<id>.json。
// 只做拼接与顺序，零校验（校验归 validate.py）。
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DATA = path.join(ROOT, 'data')
const COMPANIES = path.join(DATA, 'companies')

function loadDataset(root) {
  const base = root ? path.resolve(root) : ROOT
  const dataDir = path.join(base, 'data')
  const compDir = path.join(dataDir, 'companies')
  if (!fs.existsSync(path.join(dataDir, 'meta.json'))) {
    throw new Error(`assemble.cjs: ${dataDir}/meta.json 不存在（数据分片真相源缺失）`)
  }
  const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf-8'))
  const order = meta.company_order
  if (!Array.isArray(order) || !order.length) {
    throw new Error('assemble.cjs: data/meta.json 缺 company_order')
  }
  const files = new Set(fs.readdirSync(compDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')))
  const missing = order.filter(id => !files.has(id))
  const extra = [...files].filter(id => !order.includes(id))
  if (missing.length || extra.length) {
    throw new Error(`assemble.cjs: company_order 与 data/companies/*.json 不一致：缺 [${missing}]；多 [${extra}]`)
  }
  return {
    meta,
    companies: order.map(id => JSON.parse(fs.readFileSync(path.join(compDir, id + '.json'), 'utf-8'))),
  }
}

module.exports = { loadDataset, ROOT }

if (require.main === module) {
  // CLI：打印组装结果（管道/调试）。--out FILE 写文件。
  const outIdx = process.argv.indexOf('--out')
  const text = JSON.stringify(loadDataset(), null, 2)
  if (outIdx > 0 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], text + '\n')
    console.error(`assembled → ${process.argv[outIdx + 1]}`)
  } else {
    console.log(text)
  }
}
