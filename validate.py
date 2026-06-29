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
from urllib.parse import urlparse

TOL = 0.05  # USD bn tolerance for reconciliation

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
    for c in data.get("companies", []):
        cid = c.get("id", "?")
        if cid in seen_ids:
            errors.append(f"ERROR 公司 id 重复: {cid}")
        seen_ids.add(cid)

        if c.get("status") == "pending":
            if not c.get("planned_source"):
                warns.append(f"WARN  {cid}: 预留槽位缺少 planned_source")
            if c.get("years"):
                warns.append(f"WARN  {cid}: 标记 pending 却已有 years 数据")
            continue

        if not c.get("years"):
            warns.append(f"WARN  {cid}: populated 但没有任何财年")

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
