#!/usr/bin/env python3
"""
validate.py — ingest-time QA gate for the AI profit-pool dataset.

Run after any data change (manual entry or collector output):
    python3 validate.py companies.json [schema.json]

It enforces the invariants this whole project exists to protect:
  - schema conformance (if `jsonschema` is installed; else a structural fallback)
  - reconciliation: platform-segment revenue and complete product hierarchies must sum to company revenue
  - provenance: every actual year and every source must carry a source URL + data_status
  - sanity: net_income <= revenue for operating companies, margins in [0,1], etc.
Derived metrics are never stored, so they are never validated here — only raw facts.
Exit code is non-zero if any ERROR is found (so it can gate a pipeline).
"""
import json, re, sys
from datetime import date
from urllib.parse import urlparse

TOL = 0.05  # USD bn tolerance for reconciliation
RB_TOL = 0.001  # revenue_breakdown 专用容差：产品层级按 4 位小数录入，对账要求精确（≤$1M）
GM_TOL = 0.001  # annual gross_profit/revenue 与 legacy gross_margin 的比率容差
TODAY = date.today()  # 取真实当日，用于快照新鲜度判断（as_of 晚于今天 / 早于 90 天 → WARN）
INVESTMENT_INCOME_CAN_EXCEED_REVENUE = {"softbank"}
GROSS_PROFIT_POLICY_EXEMPT = {"amazon"}  # 不披露传统公司层面毛利，B2 按政策诚实留空

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def schema_check(data, schema_path):
    try:
        import jsonschema  # optional
    except ImportError:
        return ["INFO  jsonschema 未安装，跳过 JSON Schema 校验（已做结构化兜底检查）"]
    try:
        schema = load(schema_path)
        jsonschema.Draft7Validator(schema, format_checker=jsonschema.FormatChecker()).validate(data)
        return ["OK    JSON Schema 校验通过"]
    except Exception as e:
        return ["ERROR JSON Schema 校验失败: " + str(e).splitlines()[0]]

def allows_net_income_above_revenue(cid):
    # SoftBank 的利润高度受投资收益/估值重估驱动；这些收益不进入 Net sales，
    # 所以单季归母净利可能超过销售收入。其他公司继续保留强校验。
    return cid in INVESTMENT_INCOME_CAN_EXCEED_REVENUE

def check_revenue_breakdown(owner, revenue, tag, errors, oks):
    """Validate a source-backed product/revenue hierarchy independently of segments[]."""
    rb = owner.get("revenue_breakdown")
    if not rb:
        return

    sources = rb.get("sources") or []
    if not sources:
        errors.append(f"ERROR {tag}/revenue_breakdown: 缺少 sources")
    for source in sources:
        url = source.get("url") or ""
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            errors.append(f"ERROR {tag}/revenue_breakdown: source URL 非 http(s) 绝对链接: {url or '空'}")
        if not source.get("url") or not source.get("data_status"):
            errors.append(f"ERROR {tag}/revenue_breakdown: source 缺少 url 或 data_status")

    def walk(items, path=""):
        sibling_names = set()
        for item in items:
            name = item.get("name", "?")
            item_path = f"{path}/{name}" if path else name
            if name in sibling_names:
                errors.append(f"ERROR {tag}/revenue_breakdown:{path or 'root'} 同级名称重复: {name}")
            sibling_names.add(name)
            value = item.get("revenue")
            if not isinstance(value, (int, float)):
                errors.append(f"ERROR {tag}/revenue_breakdown:{item_path} revenue 必须为数值")
                continue
            children = item.get("children") or []
            if children:
                child_sum = round(sum(x.get("revenue", 0) for x in children if isinstance(x.get("revenue"), (int, float))), 4)
                diff = round(child_sum - value, 4)
                if abs(diff) <= RB_TOL:
                    oks.append(f"INFO  {tag}/revenue_breakdown:{item_path} 子项合计 {child_sum} = {value} ✓")
                else:
                    errors.append(f"ERROR {tag}/revenue_breakdown:{item_path} 子项合计 {child_sum} ≠ {value}（差 {diff:+}）")
                walk(children, item_path)

    items = rb.get("items") or []
    walk(items)
    if rb.get("complete"):
        if revenue is None:
            errors.append(f"ERROR {tag}/revenue_breakdown: complete=true 但该期 revenue 为空——"
                          f"无从对账，要么补 revenue，要么改 complete=false")
        else:
            total = round(sum(x.get("revenue", 0) for x in items if isinstance(x.get("revenue"), (int, float))), 4)
            diff = round(total - revenue, 4)
            if abs(diff) <= RB_TOL:
                oks.append(f"OK    {tag}/revenue_breakdown: 顶层合计 {total} = 营收 {revenue} ✓ 对账通过")
            else:
                errors.append(f"ERROR {tag}/revenue_breakdown: 顶层合计 {total} ≠ 营收 {revenue}（差 {diff:+}）")

def check(data):
    errors, warns, oks = [], [], []
    seen_ids = set()

    # ---- meta.stages 引用完整性（仅当存在；保持对旧数据非破坏）----
    stage_keys = set()
    stages = (data.get("meta") or {}).get("stages")
    if stages is not None:
        seen_stage = set()
        for st in stages:
            k = st.get("key")
            if k in seen_stage:
                errors.append(f"ERROR meta.stages: 环节 key 重复: {k}")
            seen_stage.add(k)
        stage_keys = seen_stage

    for c in data.get("companies", []):
        cid = c.get("id", "?")
        if cid in seen_ids:
            errors.append(f"ERROR 公司 id 重复: {cid}")
        seen_ids.add(cid)

        # ---- chain_stage 引用完整性（仅当字段存在）----
        cs = c.get("chain_stage")
        if cs is not None:
            if not stage_keys:
                errors.append(f"ERROR {cid}: chain_stage='{cs}' 但 meta.stages 未定义，无法校验引用")
            elif cs not in stage_keys:
                errors.append(f"ERROR {cid}: chain_stage='{cs}' 不在 meta.stages 的 key 集合 {sorted(stage_keys)}")

        # ---- AI 归因 share（仅当非空）：∈[0,1] 且必须带 ai_share_source（每条 url+data_status）----
        ai_shares = {k: c.get(k) for k in ("ai_profit_share", "ai_revenue_share") if c.get(k) is not None}
        if ai_shares:
            for k, v in ai_shares.items():
                if not isinstance(v, (int, float)) or not (0 <= v <= 1):
                    errors.append(f"ERROR {cid}: {k}={v!r} 不在 [0,1]")
            src = c.get("ai_share_source") or []
            if not src:
                errors.append(f"ERROR {cid}: {'/'.join(ai_shares)} 非空但缺少 ai_share_source（provenance 必填）")
            for s in src:
                url = s.get("url") or ""
                parsed = urlparse(url)
                if parsed.scheme not in ("http", "https") or not parsed.netloc:
                    errors.append(f"ERROR {cid}/ai_share_source: source URL 非 http(s) 绝对链接: {url or '空'}")
                if not s.get("url") or not s.get("data_status"):
                    errors.append(f"ERROR {cid}/ai_share_source: source 缺少 url 或 data_status")

        if c.get("status") == "pending":
            if not c.get("planned_source"):
                warns.append(f"WARN  {cid}: 预留槽位缺少 planned_source")
            if c.get("years"):
                warns.append(f"WARN  {cid}: 标记 pending 却已有 years 数据")
            continue

        if not c.get("years"):
            warns.append(f"WARN  {cid}: populated 但没有任何财年")

        # ---- 市场快照（quote）：只校验原始事实，倍数由派生层算 ----
        q = c.get("quote")
        if q is not None:
            mc = q.get("market_cap")
            if mc is None or mc <= 0:
                errors.append(f"ERROR {cid}/quote: market_cap 必须 > 0（当前 {mc}）")
            price = q.get("price")
            if price is not None and price <= 0:
                errors.append(f"ERROR {cid}/quote: price 若存在需 > 0（当前 {price}）")
            nd = q.get("net_debt")
            if nd is not None and not isinstance(nd, (int, float)):
                errors.append(f"ERROR {cid}/quote: net_debt 若存在需为数值（当前 {nd!r}）")
            # net_debt 不该等于 −market_cap 量级以下（EV<0 极不合理，提示口径错误）
            if isinstance(nd, (int, float)) and mc and (mc + nd) < 0:
                errors.append(f"ERROR {cid}/quote: net_debt {nd} 使 EV = 市值+净负债 < 0（口径异常）")
            qsrc = q.get("sources") or []
            if not qsrc:
                errors.append(f"ERROR {cid}/quote: 缺少 sources")
            for s in qsrc:
                url = s.get("url") or ""
                parsed = urlparse(url)
                if parsed.scheme not in ("http", "https") or not parsed.netloc:
                    errors.append(f"ERROR {cid}/quote: source URL 非 http(s) 绝对链接: {url or '空'}")
                if not s.get("url") or not s.get("data_status"):
                    errors.append(f"ERROR {cid}/quote: source 缺少 url 或 data_status")
            # as_of 新鲜度
            as_of_raw = q.get("as_of")
            as_of = None
            try:
                as_of = date.fromisoformat(as_of_raw) if as_of_raw else None
            except ValueError:
                errors.append(f"ERROR {cid}/quote: as_of 非 ISO 日期: {as_of_raw}")
            if as_of:
                if as_of > TODAY:
                    warns.append(f"WARN  {cid}/quote: as_of {as_of} 晚于今天（{TODAY}）")
                elif (TODAY - as_of).days > 90:
                    warns.append(f"WARN  {cid}/quote: as_of {as_of} 早于今天 90 天以上，快照可能过期")
            # INFO：展示可派生的倍数（便于核对，派生不存）
            ya = [y for y in c.get("years", []) if y.get("status") == "actual"]
            ly = ya[-1] if ya else None
            cav = c.get("valuation_caveat") or {}
            if mc and ly:
                rev, ni = ly.get("revenue"), ly.get("net_income")
                cfo, capex = ly.get("cfo"), ly.get("capex")
                parts = []
                if cav.get("pe") != "na" and ni:
                    parts.append(f"PE {round(mc / ni, 1)}" + ("(失真)" if cav.get("pe") == "distorted" else ""))
                if cav.get("ps") != "na" and rev:
                    parts.append(f"PS {round(mc / rev, 1)}" + ("(失真)" if cav.get("ps") == "distorted" else ""))
                if cav.get("fcf_yield") != "na" and cfo is not None and capex is not None and mc:
                    parts.append(f"FCF yield {round((cfo - capex) / mc * 100, 1)}%" + ("(失真)" if cav.get("fcf_yield") == "distorted" else ""))
                nd = q.get("net_debt")
                if cav.get("ev_sales") != "na" and nd is not None and rev:
                    ev = mc + nd
                    parts.append(f"EV {round(ev, 1)}(净{'负债' if nd > 0 else '现金'} {abs(round(nd,1))}) · EV/Sales {round(ev / rev, 1)}" + ("(失真)" if cav.get("ev_sales") == "distorted" else ""))
                if parts:
                    oks.append(f"INFO  {cid}/quote: 市值 {mc} USD bn @ {as_of_raw} → 可派生 {' · '.join(parts)}（基于 {ly.get('fy')}）")
                else:
                    oks.append(f"INFO  {cid}/quote: 市值 {mc} USD bn @ {as_of_raw}（按 caveat 无可展示倍数）")

        # ---- periods[]（period-base 重构，加性；仅当存在，旧数据无 periods → 完全跳过）----
        # 原始报告期事实：日期先后、period_id 公司内唯一、季度必带 calendar_quarter、
        # calendar_year = period_end 年、非 USD 必带正 fx、actual 无金融字段→WARN、
        # 分部营收非负、平台分部仅在 status=actual 的完整平台分部集时强制对账。
        seen_pids = set()
        for p in c.get("periods", []) or []:
            pid = p.get("period_id", "?")
            ptag = f"{cid}/period:{pid}"
            kind, status = p.get("kind"), p.get("status")
            if pid in seen_pids:
                errors.append(f"ERROR {ptag}: period_id 在公司内重复")
            seen_pids.add(pid)
            # 日期先后（period_start 可为 null）
            ps_raw, pe_raw = p.get("period_start"), p.get("period_end")
            ps = pe = None
            try:
                ps = date.fromisoformat(ps_raw) if ps_raw else None
            except ValueError:
                errors.append(f"ERROR {ptag}: period_start 非 ISO 日期: {ps_raw}")
            try:
                pe = date.fromisoformat(pe_raw) if pe_raw else None
            except ValueError:
                errors.append(f"ERROR {ptag}: period_end 非 ISO 日期: {pe_raw}")
            if pe is None and pe_raw is None:
                errors.append(f"ERROR {ptag}: 缺少 period_end")
            if ps and pe and ps > pe:
                errors.append(f"ERROR {ptag}: period_start({ps}) 晚于 period_end({pe})")
            # kind=quarter 必带合法 calendar_quarter（Q1-Q4）；annual 若给也须合法
            cq = p.get("calendar_quarter")
            if kind == "quarter":
                if cq not in ("Q1", "Q2", "Q3", "Q4"):
                    errors.append(f"ERROR {ptag}: kind=quarter 必须带 calendar_quarter ∈ Q1-Q4（当前 {cq!r}）")
            elif cq is not None and cq not in ("Q1", "Q2", "Q3", "Q4"):
                errors.append(f"ERROR {ptag}: calendar_quarter 若存在须为 Q1-Q4（当前 {cq!r}）")
            # calendar_year 必须 = period_end 的年（暂无例外）
            cy = p.get("calendar_year")
            if cy is not None and pe is not None and cy != pe.year:
                errors.append(f"ERROR {ptag}: calendar_year({cy}) ≠ period_end 年份({pe.year})")
            # 源币非 USD → fx_to_usd 必须存在且为正
            cur, fx = p.get("currency"), p.get("fx_to_usd")
            if cur and cur != "USD":
                if not isinstance(fx, (int, float)) or fx <= 0:
                    errors.append(f"ERROR {ptag}: 源币 {cur} 非 USD，fx_to_usd 必须存在且为正（当前 {fx!r}）")
            # provenance
            if not p.get("sources"):
                errors.append(f"ERROR {ptag}: 缺少 sources")
            for s in p.get("sources", []):
                url = s.get("url") or ""
                parsed = urlparse(url)
                if parsed.scheme not in ("http", "https") or not parsed.netloc:
                    errors.append(f"ERROR {ptag}: source URL 非 http(s) 绝对链接: {url or '空'}")
                if not s.get("url") or not s.get("data_status"):
                    errors.append(f"ERROR {ptag}: source 缺少 url 或 data_status")
            # 金融字段合理性（全部可 null；仅在存在时校验）
            rev, ni = p.get("revenue"), p.get("net_income")
            if rev is not None and rev < 0:
                errors.append(f"ERROR {ptag}: revenue({rev}) < 0")
            if rev is not None and ni is not None and ni > rev + TOL and not allows_net_income_above_revenue(cid):
                errors.append(f"ERROR {ptag}: net_income({ni}) > revenue({rev})")
            elif rev is not None and ni is not None and ni > rev + TOL:
                oks.append(f"INFO  {ptag}: net_income({ni}) > revenue({rev})，投资收益口径已按公司例外放行")
            capex = p.get("capex")
            if capex is not None and capex < 0:
                errors.append(f"ERROR {ptag}: capex({capex}) < 0（请存非负量级，方向由派生层处理）")
            # B2 annual actual 视图以 gross_profit 为唯一毛利事实源。当前政策只豁免
            # Amazon（不披露传统公司层面毛利）；其余 annual actual 缺失直接阻断。
            if kind == "annual" and status == "actual" and p.get("gross_profit") is None:
                if cid in GROSS_PROFIT_POLICY_EXEMPT:
                    oks.append(f"INFO  {ptag}: gross_profit 按公司披露政策豁免，B2 毛利率诚实留空")
                else:
                    errors.append(f"ERROR {ptag}: annual actual 缺 gross_profit —— B2 年度毛利视图无事实源")
            # 政策豁免是双向禁令：豁免公司**任何 period**（annual/quarter，任何 status）都不得
            # 携带非 null gross_profit——revenue − cost of sales 的重构毛利不可比且误导
            # （正式 DoD 验收 P1：amazon 2026Q1 曾漏网 $94.1B derived 毛利，此处制度化封死）。
            if cid in GROSS_PROFIT_POLICY_EXEMPT and p.get("gross_profit") is not None:
                errors.append(f"ERROR {ptag}: gross_profit={p.get('gross_profit')} 违反公司披露政策豁免"
                              f"（{cid} 不披露传统毛利，重构值不可比）—— 必须为 null")
            # status=actual 却无任何金融事实 → WARN（guidance 允许缺 net_income，不告警）
            if status == "actual" and rev is None and p.get("op_income") is None and ni is None:
                warns.append(f"WARN  {ptag}: status=actual 但无任何金融事实（revenue/op_income/net_income 全缺）")
            check_revenue_breakdown(p, rev, ptag, errors, oks)
            # 分部：营收非负；平台分部仅在 status=actual 的（视为完整的）平台分部集时强制对账，
            # guidance / division 口径不强制（含内部交易 / 部分分部）。
            psegs = [s for s in p.get("segments", []) if s.get("revenue") is not None]
            for sg in psegs:
                if sg.get("revenue") is not None and sg["revenue"] < 0:
                    errors.append(f"ERROR {ptag}: segment '{sg.get('name','?')}' revenue({sg['revenue']}) < 0")
            if psegs and rev is not None and status == "actual":
                if not any(sg.get("kind") == "division" for sg in psegs):
                    ssum = round(sum(sg["revenue"] for sg in psegs), 4)
                    diff = round(ssum - rev, 4)
                    if abs(diff) <= TOL:
                        oks.append(f"INFO  {ptag}: 平台合计 {ssum} = 营收 {rev} ✓ 对账通过")
                    else:
                        errors.append(f"ERROR {ptag}: 平台合计 {ssum} ≠ 营收 {rev}（差 {diff:+}）")

        fy_seen, fy_nums = set(), []
        any_segment_profit = False
        for y in c.get("years", []):
            tag = f"{cid}/{y.get('fy','?')}"
            status = y.get("status")
            fy = y.get("fy")

            if fy in fy_seen:
                errors.append(f"ERROR {tag}: 财年重复")
            fy_seen.add(fy)
            m = re.fullmatch(r"FY(\d{4})E?", fy or "")
            if m:
                fy_nums.append((fy, int(m.group(1))))
            else:
                warns.append(f"WARN  {tag}: 财年格式不是 FY2025 / FY2025E")

            for s in y.get("sources", []):
                url = s.get("url") or ""
                parsed = urlparse(url)
                if parsed.scheme not in ("http", "https") or not parsed.netloc:
                    errors.append(f"ERROR {tag}: source URL 非 http(s) 绝对链接: {url or '空'}")

            if status == "actual":
                rev, ni = y.get("revenue"), y.get("net_income")
                check_revenue_breakdown(y, rev, tag, errors, oks)
                if rev is not None and rev < 0:
                    errors.append(f"ERROR {tag}: revenue({rev}) < 0")
                # provenance
                if not y.get("sources"):
                    errors.append(f"ERROR {tag}: 实际年缺少 sources")
                for s in y.get("sources", []):
                    if not s.get("url") or not s.get("data_status"):
                        errors.append(f"ERROR {tag}: source 缺少 url 或 data_status")
                # sanity
                if rev is not None and ni is not None and ni > rev + TOL and not allows_net_income_above_revenue(cid):
                    errors.append(f"ERROR {tag}: net_income({ni}) > revenue({rev})")
                elif rev is not None and ni is not None and ni > rev + TOL:
                    oks.append(f"INFO  {tag}: net_income({ni}) > revenue({rev})，投资收益口径已按公司例外放行")
                # cash & capital intensity (raw facts; FCF is derived, never stored)
                capex, cfo = y.get("capex"), y.get("cfo")
                if capex is not None and capex < 0:
                    errors.append(f"ERROR {tag}: capex({capex}) < 0（请存非负量级，方向由派生层处理）")
                if (capex is None) != (cfo is None):
                    warns.append(f"WARN  {tag}: capex 与 cfo 只录了一个，FCF 无法派生（建议成对录入）")
                if capex is not None and cfo is not None:
                    oks.append(f"INFO  {tag}: FCF 可派生 = CFO {cfo} − capex {capex} = {round(cfo - capex, 4)}（capex 强度 {round(capex / rev * 100, 1) if rev else '—'}%）")
                for mkey in ("gross_margin",):
                    mv = y.get(mkey)
                    if mv is not None and not (0 <= mv <= 1):
                        errors.append(f"ERROR {tag}: {mkey}={mv} 不在 [0,1]")
                # reconciliation: platform segments must sum to revenue;
                # division segments include inter-segment sales (sum > consolidated, expected).
                rsegs = [s for s in y.get("segments", []) if s.get("revenue") is not None]
                if rsegs and rev is not None:
                    for p in rsegs:
                        pname = p.get("name", "?")
                        if p.get("revenue") is not None and p["revenue"] < 0:
                            errors.append(f"ERROR {tag}: segment '{pname}' revenue({p['revenue']}) < 0")
                        if p.get("op_margin") is not None and not (-1 <= p["op_margin"] <= 1):
                            errors.append(f"ERROR {tag}: segment '{pname}' op_margin={p['op_margin']} 不在 [-1,1]")
                        if p.get("op_income") is not None:
                            any_segment_profit = True
                            if p.get("revenue") is not None and p["op_income"] > p["revenue"] + TOL:
                                errors.append(f"ERROR {tag}: segment '{pname}' op_income({p['op_income']}) > revenue({p['revenue']})")
                    s = round(sum(p["revenue"] for p in rsegs), 4)
                    kind = "division" if any(p.get("kind") == "division" for p in rsegs) else "platform"
                    if kind == "platform":
                        diff = round(s - rev, 4)
                        if abs(diff) <= TOL:
                            oks.append(f"OK    {tag}: 平台合计 {s} = 营收 {rev} ✓ 对账通过")
                        else:
                            errors.append(f"ERROR {tag}: 平台合计 {s} ≠ 营收 {rev}（差 {diff:+}）")
                    else:
                        if s < rev - TOL:
                            errors.append(f"ERROR {tag}: division 分部合计 {s} < 合并营收 {rev}（方向异常）")
                        oks.append(f"INFO  {tag}: 分部合计 {s} > 合并营收 {rev}（含内部交易，正常，不强制对账）")
                # informational: does this year disclose segment profit?
                has_profit = any(p.get("op_income") is not None for p in rsegs)
                if rsegs:
                    if has_profit:
                        oks.append(f"INFO  {tag}: 含分部营业利润 → 下钻显示真实利润/利润率表（seg_profit='{c.get('seg_profit')}'）")
                    elif c.get("seg_profit") == "yes":
                        oks.append(f"INFO  {tag}: 公司按部门披露利润，但本财年仅录入营收 → 下钻提示待补录")
                    else:
                        oks.append(f"INFO  {tag}: 平台级利润未披露 → 下钻显式留空（seg_profit='{c.get('seg_profit')}'）")

            elif status == "forecast":
                if not y.get("sources"):
                    warns.append(f"WARN  {tag}: 预测年缺少 sources")
                for a in y.get("anchors", []):
                    if not a.get("data_status"):
                        warns.append(f"WARN  {tag}: 预测锚点 '{a.get('label')}' 缺少 data_status（可靠度不明）")
                # 数值型一致预期 EPS（前瞻 PE 派生用）：非 null 时必须带 consensus provenance
                cev = y.get("consensus_eps_value")
                if cev is not None:
                    if not isinstance(cev, (int, float)):
                        errors.append(f"ERROR {tag}: consensus_eps_value 若存在需为数值（当前 {cev!r}）")
                    cev_src = y.get("consensus_eps_source") or []
                    if not cev_src:
                        errors.append(f"ERROR {tag}: consensus_eps_value 非 null 但缺少 consensus_eps_source（provenance 必填）")
                    for s in cev_src:
                        url = s.get("url") or ""
                        parsed = urlparse(url)
                        if parsed.scheme not in ("http", "https") or not parsed.netloc:
                            errors.append(f"ERROR {tag}: consensus_eps_source URL 非 http(s) 绝对链接: {url or '空'}")
                        if s.get("data_status") != "consensus":
                            errors.append(f"ERROR {tag}: consensus_eps_source 每条 data_status 须为 'consensus'（当前 {s.get('data_status')!r}）")
                    # 币种建议 = 该公司 quote.price_currency（不一致仅 WARN，不跨币）
                    cev_cur = y.get("consensus_eps_currency")
                    price_cur = (c.get("quote") or {}).get("price_currency")
                    if cev_cur and price_cur and cev_cur != price_cur:
                        warns.append(f"WARN  {tag}: consensus_eps_currency({cev_cur}) ≠ quote.price_currency({price_cur})，前瞻 PE 将因跨币留空")
                oks.append(f"INFO  {tag}: 预测年，已与实际分流标注")

        nums = [n for _, n in fy_nums]
        if nums != sorted(nums):
            errors.append(f"ERROR {cid}: years[] 未按财年升序排列")
        for (_, prev), (cur_fy, cur) in zip(fy_nums, fy_nums[1:]):
            if cur - prev > 1:
                warns.append(f"WARN  {cid}: 财年序列存在跳年，跳到 {cur_fy}")
        if c.get("seg_profit") == "yes" and c.get("years") and not any_segment_profit:
            warns.append(f"WARN  {cid}: seg_profit='yes' 但没有任何实际年录入分部营业利润")
        if c.get("seg_profit") == "no" and any_segment_profit:
            errors.append(f"ERROR {cid}: seg_profit='no' 但已录入分部营业利润")

        # ---- segment_framework 口径身份契约（ADR nvda-framework-change D5）----
        # segment_framework 是"这组 segments 属哪个口径版本"的 opaque token（year/period 两级）。
        #   Rule B（完整性）: 本公司任一含 segments 的 carrier 启用了 token → 其余含 segments 的
        #     carrier 缺 token 也 WARN。selector 按 D2 对单边缺 token 的跨期同比失败关闭（返回 null，
        #     诚实但不完整），此处提示补齐。
        #   Rule A（断裂需说明）: 只在 selector 可能做同比的同 cadence actual 序列内比较：years 按
        #     财年序；annual periods 独立；quarter periods 再按同一 fiscal/calendar quarter 分组。
        #     token 跳变 → 后一个 carrier SHOULD 带 framework_change 人话说明；缺 → WARN（非 ERROR）。
        #     annual 与 quarter 不是同比基期，绝不硬相邻。
        #   对账/双写语义不受 token 影响（仍按 kind：platform/reportable 强制、division 不强制）。
        year_rows = [y for y in c.get("years", [])
                     if any(s.get("name") for s in (y.get("segments") or []))]
        year_carriers = [("year", y.get("fy", "?"), y.get("segment_framework"), y.get("framework_change"))
                         for y in year_rows]
        period_rows = sorted(
            [p for p in (c.get("periods") or [])
             if any(s.get("name") for s in (p.get("segments") or []))],
            key=lambda p: p.get("period_end") or "")
        period_carriers = [("period", p.get("period_id", "?"), p.get("segment_framework"),
                            p.get("framework_change")) for p in period_rows]
        all_carriers = year_carriers + period_carriers
        if any(tok is not None for _, _, tok, _ in all_carriers):
            # Rule B：任一 carrier 带 token → 其余含 segments 的 carrier 缺 token 报 WARN
            for _lbl, ident, tok, _fc in all_carriers:
                if tok is None:
                    warns.append(f"WARN  {cid}/{ident}: 含 segments 却缺 segment_framework —— 本公司已在别处"
                                 f"启用口径 token，缺标将使跨期分部同比失败关闭（诚实但不完整），请补齐")
            # Rule A：仅比较同 cadence 的 actual carrier，避免 annual↔quarter 伪相邻。
            actual_year_carriers = [k for k, y in zip(year_carriers, year_rows)
                                    if y.get("status") == "actual"]
            period_sequences = []
            cadence_keys = []
            for p in period_rows:
                if p.get("status") != "actual":
                    continue
                if p.get("kind") == "annual":
                    cadence = ("annual", None)
                else:
                    cadence = ("quarter", p.get("fiscal_quarter") or p.get("calendar_quarter"))
                if cadence not in cadence_keys:
                    cadence_keys.append(cadence)
                    period_sequences.append([])
                period_sequences[cadence_keys.index(cadence)].append(
                    ("period", p.get("period_id", "?"), p.get("segment_framework"),
                     p.get("framework_change")))
            for seq in [actual_year_carriers, *period_sequences]:
                toks = [k for k in seq if k[2] is not None]
                for (_pl, _pid, ptok, _pfc), (_cl, cident, ctok, cfc) in zip(toks, toks[1:]):
                    if ptok != ctok and not cfc:
                        warns.append(f"WARN  {cid}/{cident}: segment_framework 由「{ptok}」跳变为「{ctok}」，"
                                     f"却无 framework_change 说明 —— 口径断裂应给人话解释（D5）")

        # ---- 双写一致性（B1 估值链迁移配套兜底）----
        # 估值链分母已切到 periods[] 侧「最新实际 annual period」，运行时不再回退 years[]。
        # 双写纪律（年度 actual 事实同写 periods annual 与 legacy years）目前是人工约定，此处
        # 在闸门显式钉住：每条 years[] actual 记录，必须有一条 kind=annual & status=actual 且财年
        # 对齐（fiscal_year==fy，否则按 period_end 年份对齐 years.period_end_iso 年）的 period，
        # 且两者 revenue/net_income 在容差内相等（相对 1e-6 或绝对 0.001）。缺失/不一致 → ERROR。
        if c.get("status") == "populated":
            annuals = [p for p in (c.get("periods") or [])
                       if p.get("kind") == "annual" and p.get("status") == "actual"]
            for y in [yy for yy in c.get("years", []) if yy.get("status") == "actual"]:
                fy = y.get("fy")
                cand = [p for p in annuals if p.get("fiscal_year") == fy]
                if not cand:
                    y_iso = y.get("period_end_iso")
                    y_year = None
                    try:
                        y_year = date.fromisoformat(y_iso).year if y_iso else None
                    except ValueError:
                        y_year = None
                    if y_year is not None:
                        cand = [p for p in annuals
                                if isinstance(p.get("period_end"), str)
                                and p["period_end"][:4].isdigit()
                                and int(p["period_end"][:4]) == y_year]
                if not cand:
                    errors.append(f"ERROR {cid}/{fy}: years[] 有 actual 记录，但 periods[] 缺对应的 "
                                  f"annual actual double-write（按 fiscal_year 或 period_end 年份对齐）")
                    continue
                p = cand[0]
                p_tag = p.get("fiscal_year") or p.get("period_end")

                def num_close(a, b):
                    return abs(a - b) <= 0.001 or (a != 0 and abs(a - b) / abs(a) <= 1e-6)

                # B2(D4): headline 流量字段全纳入双写钉子。gross 两侧表示不同
                # (years=gross_margin, periods=gross_profit)，在下方按比率单独对账。
                for field in ("revenue", "net_income", "op_income", "cfo", "capex"):
                    yv, pv = y.get(field), p.get(field)
                    if yv is None:
                        continue
                    if pv is None:
                        errors.append(f"ERROR {cid}/{fy}: double-write 不一致 —— years.{field}={yv} 但 "
                                      f"annual period（{p_tag}）该字段缺失")
                        continue
                    if not num_close(yv, pv):
                        errors.append(f"ERROR {cid}/{fy}: double-write 不一致 —— years.{field}={yv} ≠ "
                                      f"annual period.{field}={pv}（差 {round(pv - yv, 6):+}，超容差）")

                y_gm, p_gp, p_rev = y.get("gross_margin"), p.get("gross_profit"), p.get("revenue")
                if y_gm is not None:
                    if p_gp is None or not p_rev:
                        errors.append(f"ERROR {cid}/{fy}: gross double-write 无从对账 —— "
                                      f"years.gross_margin={y_gm} 但 annual period 缺 gross_profit/revenue")
                    else:
                        p_gm = p_gp / p_rev
                        if abs(p_gm - y_gm) > GM_TOL:
                            errors.append(f"ERROR {cid}/{fy}: gross double-write 不一致 —— "
                                          f"years.gross_margin={y_gm} ≠ annual gross_profit/revenue={round(p_gm, 6)}"
                                          f"（差 {round(p_gm - y_gm, 6):+}，超 {GM_TOL}）")

                # B2(D4): 逐分部（按 name 对齐）钉住 revenue/op_income/op_margin/is_ai/kind。
                # years 分部有名字但 periods 缺同名分部 → ERROR；同名分部逐字段比对。
                p_segs = {s.get("name"): s for s in (p.get("segments") or []) if s.get("name")}
                for ys in (y.get("segments") or []):
                    nm = ys.get("name")
                    if nm is None:
                        continue
                    ps = p_segs.get(nm)
                    if ps is None:
                        errors.append(f"ERROR {cid}/{fy}: double-write 分部不一致 —— years 有分部「{nm}」，"
                                      f"但 annual period（{p_tag}）缺同名分部")
                        continue
                    for field in ("revenue", "op_income", "op_margin"):
                        yv, pv = ys.get(field), ps.get(field)
                        if yv is None:
                            continue
                        if pv is None:
                            errors.append(f"ERROR {cid}/{fy}: 分部「{nm}」double-write 不一致 —— "
                                          f"years.{field}={yv} 但 annual period 该字段缺失")
                            continue
                        if not num_close(yv, pv):
                            errors.append(f"ERROR {cid}/{fy}: 分部「{nm}」double-write 不一致 —— "
                                          f"years.{field}={yv} ≠ annual period.{field}={pv}"
                                          f"（差 {round(pv - yv, 6):+}，超容差）")
                    for field in ("is_ai", "kind"):
                        yv, pv = ys.get(field), ps.get(field)
                        if yv is None:
                            continue
                        if yv != pv:
                            errors.append(f"ERROR {cid}/{fy}: 分部「{nm}」double-write 不一致 —— "
                                          f"years.{field}={yv!r} ≠ annual period.{field}={pv!r}")

                # 反向：annual period 多出 years 没有的分部同样是双写破裂（两侧各自对得上
                # 总营收、内部构成却不同，legacy 年度页与 periods 链会展示不同拆分）。
                y_seg_names = {s.get("name") for s in (y.get("segments") or []) if s.get("name")}
                for nm in p_segs:
                    if nm not in y_seg_names:
                        errors.append(f"ERROR {cid}/{fy}: double-write 分部不一致 —— annual period（{p_tag}）"
                                      f"有分部「{nm}」，但 years 缺同名分部")

                # B2 actual 下钻还会消费可报告分部的人话说明；两侧要么都无，
                # 要么整个对象相等，否则迁移后会出现「数值不变、语义消失」。
                if y.get("reportable_note") != p.get("reportable_note"):
                    errors.append(f"ERROR {cid}/{fy}: reportable_note double-write 不一致 —— "
                                  f"years={y.get('reportable_note')!r} ≠ annual period={p.get('reportable_note')!r}")

                # revenue_breakdown 双写：年度事实两侧要么都有、要么都无；都有则整树深比较
                # （label/complete、逐层同名集合、逐节点 revenue ≤ RB_TOL）。
                y_rb, p_rb = y.get("revenue_breakdown"), p.get("revenue_breakdown")
                if (y_rb is None) != (p_rb is None):
                    side = "years" if y_rb is not None else f"annual period（{p_tag}）"
                    other = f"annual period（{p_tag}）" if y_rb is not None else "years"
                    errors.append(f"ERROR {cid}/{fy}: revenue_breakdown 只写了 {side} 一侧，{other} 缺失"
                                  f"——年度事实须双写")
                elif y_rb is not None and p_rb is not None:
                    if y_rb.get("label") != p_rb.get("label") or bool(y_rb.get("complete")) != bool(p_rb.get("complete")):
                        errors.append(f"ERROR {cid}/{fy}: revenue_breakdown double-write 不一致 —— "
                                      f"label/complete 两侧不同")

                    def rb_tree_diff(y_items, p_items, path):
                        y_map = {i.get("name"): i for i in (y_items or []) if i.get("name")}
                        p_map = {i.get("name"): i for i in (p_items or []) if i.get("name")}
                        for nm in set(y_map) | set(p_map):
                            node = f"{path}/{nm}" if path else nm
                            yi, pi = y_map.get(nm), p_map.get(nm)
                            if yi is None or pi is None:
                                miss = "annual period" if pi is None else "years"
                                errors.append(f"ERROR {cid}/{fy}: revenue_breakdown double-write 不一致 —— "
                                              f"节点「{node}」在 {miss} 侧缺失")
                                continue
                            yv, pv = yi.get("revenue"), pi.get("revenue")
                            if isinstance(yv, (int, float)) and isinstance(pv, (int, float)) and abs(yv - pv) > RB_TOL:
                                errors.append(f"ERROR {cid}/{fy}: revenue_breakdown double-write 不一致 —— "
                                              f"节点「{node}」revenue {yv} ≠ {pv}（差 {round(pv - yv, 6):+}）")
                            rb_tree_diff(yi.get("children"), pi.get("children"), node)

                    rb_tree_diff(y_rb.get("items"), p_rb.get("items"), "")

    return errors, warns, oks

def main():
    if len(sys.argv) < 2:
        print("用法: python3 validate.py companies.json [schema.json]"); sys.exit(2)
    data = load(sys.argv[1])
    schema_path = sys.argv[2] if len(sys.argv) > 2 else None

    lines = []
    if schema_path:
        lines += schema_check(data, schema_path)
    schema_errors = [l for l in lines if l.startswith("ERROR")]
    errors, warns, oks = check(data)

    print("=" * 60)
    print(" 数据校验报告  ".center(60, "="))
    print("=" * 60)
    for l in lines + oks + warns + errors:
        print(" " + l)
    print("-" * 60)
    pop = [c for c in data["companies"] if c.get("status") == "populated"]
    pend = [c for c in data["companies"] if c.get("status") == "pending"]
    print(f" 公司: {len(data['companies'])}（已补录 {len(pop)} · 预留 {len(pend)}）")
    print(f" 结果: {len(oks)} OK/INFO · {len(warns)} WARN · {len(errors) + len(schema_errors)} ERROR")
    print("=" * 60)
    sys.exit(1 if errors or schema_errors else 0)

if __name__ == "__main__":
    main()
