// ESLint flat config —— 落地 ADR 决策 5 承诺的不变量闸门（A3）。
// 唯一目的：机器化钉死「组件只能从 web/src/lib/data.js 拿业务」——
// 禁止任何组件/图表直接 import 业务真相模块（data-module.js）或原始数据（companies.json）。
// 唯一豁免：web/src/lib/data.js（ESM 适配壳，本就是唯一允许接触 data-module.js 的地方）。
// 挂进 package.json 的 lint 脚本 + prebuild，与 validate/test 同级成为构建闸门。
import js from '@eslint/js'
import svelte from 'eslint-plugin-svelte'
import svelteParser from 'svelte-eslint-parser'
import globals from 'globals'

// runes 是编译期宏，非全局变量——声明为只读全局避免 no-undef 误报。
const runes = { $state: 'readonly', $derived: 'readonly', $props: 'readonly', $effect: 'readonly', $bindable: 'readonly', $inspect: 'readonly' }

// 禁止直连业务真相的 import 规则（组件/图表通用）。paths 用 glob 覆盖任意相对深度。
const noDirectDataAccess = {
  'no-restricted-imports': ['error', {
    patterns: [
      {
        group: ['**/data-module.js', '**/data-module', '*/data-module.js'],
        message: '组件禁止直接 import data-module.js（不变量 5）——业务只从 web/src/lib/data.js 取。',
      },
      {
        group: ['**/companies.json', '*/companies.json'],
        message: '组件禁止直接 import companies.json（不变量 5）——数据经 Store，业务从 web/src/lib/data.js 取。',
      },
    ],
  }],
}

export default [
  { ignores: ['dist/**', 'node_modules/**', '*.config.js'] },

  // JS 源（main.js / lib/*.js，含 *.svelte.js runes 模块）
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...runes },
    },
    // 只挂 import 边界闸门 + no-undef（本轮 A3 目标：钉死不变量 5 的导入边界）。
    // 不引 svelte/recommended 全套——其 no-at-html-tags 会误伤已登记的桑基 {@html}
    // 过渡债（TECH-DEBT.md #1），require-each-key 属风格非本轮范围，避免闸门越界。
    rules: { 'no-undef': 'error', ...noDirectDataAccess },
  },

  // Svelte 组件与图表：仅接入 svelte 解析器 + import 边界闸门（不启 recommended 全套）。
  {
    files: ['src/**/*.svelte'],
    plugins: { svelte },
    languageOptions: {
      parser: svelteParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...runes },
    },
    rules: { ...noDirectDataAccess },
  },

  // 唯一豁免：ESM 适配壳本就是唯一允许接触 data-module.js 的地方。
  {
    files: ['src/lib/data.js'],
    rules: { 'no-restricted-imports': 'off' },
  },
]
