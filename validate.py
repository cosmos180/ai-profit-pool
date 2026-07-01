#!/usr/bin/env python3
"""
validate.py — ingest-time QA gate for the AI profit-pool dataset.

Run after any data change (manual entry or collector output):
    python3 validate.py companies.json [schema.json]

It enforces the invariants this whole project exists to protect:
  - schema conformance (if `jsonschema` is installed; else a structural fallback)
  - reconciliation: platform-segment revenue must sum to company revenue
  - provenance: every actual year and every source must carry a source URL + data_status
  - sanity: net_income <= revenue, margins in [0,1], etc.
Derived metrics are never stored, so they are never validated here — only raw facts.
Exit code is non-zero if any ERROR is found (so it can gate a pipeline).
"""
import json, re, sys
from datetime import date
from urllib.parse import urlparse

TOL = 0.05  # USD bn tolerance for reconciliation
TODAY = date(2026, 6, 30)  # 项目"今天"，用于快照新鲜度判断

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
                if rev is not None and rev < 0:
                    errors.append(f"ERROR {tag}: revenue({rev}) < 0")
                # provenance
                if not y.get("sources"):
                    errors.append(f"ERROR {tag}: 实际年缺少 sources")
                for s in y.get("sources", []):
                    if not s.get("url") or not s.get("data_status"):
                        errors.append(f"ERROR {tag}: source 缺少 url 或 data_status")
                # sanity
                if rev is not None and ni is not None and ni > rev + TOL:
                    errors.append(f"ERROR {tag}: net_income({ni}) > revenue({rev})")
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
