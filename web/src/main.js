// 入口：全局 CSS → await Store.load()（内部调 _refreshStages 填 STAGE_COLOR，
// 组件读 STAGE_COLOR 前必须先完成，ADR 校验点 5）→ 再 mount App。
import { mount } from 'svelte'
import './app.css'
import { Store } from './lib/data.js'
import App from './App.svelte'

const target = document.getElementById('app')

try {
  await Store.load()   // 命中 <script id="dataset"> 内联分支（file:// 不触发 fetch，校验点 2）
  mount(App, { target })
} catch (e) {
  // 诚实降级：加载失败不白屏（对齐老 init 的错误提示）。
  target.innerHTML =
    '<div class="wrap" style="padding:30px 0"><div class="note-block">数据加载失败：' +
    String(e && e.message ? e.message : e).replace(/[<>&]/g, '') +
    '。若通过 http 访问，请确保 companies.json 同目录可达。</div></div>'
}
