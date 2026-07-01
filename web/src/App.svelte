<script>
  // 路由壳（ADR 决策 4）：按 nav.view 派生当前视图组件，$derived 不存。
  import { nav } from './lib/nav.svelte.js'
  import Crumbs from './components/Crumbs.svelte'
  import Home from './components/Home.svelte'
  import Company from './components/Company.svelte'
  import Detail from './components/Detail.svelte'

  const views = { home: Home, company: Company, detail: Detail }
  const Current = $derived(views[nav.view] ?? Home)
</script>

<div class="wrap">
  <header class="top">
    <div class="eyebrow"><span class="dot"></span>AI 利润池 · 公司经营数据 · v0 · 数据已解耦</div>
    <Crumbs />
  </header>

  <Current />

  <footer>
    三层抽象：<b>登记表（公司）→ 公司（多年）→ 财年（板块）</b> · 数据：<b>companies.json</b> · 契约：<b>schema.json</b> · 校验：<b>validate.py</b> · 读取/派生：<b>data-module.js</b>
  </footer>
</div>
