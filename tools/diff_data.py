#!/usr/bin/env python3
"""
diff_data.py — 两个数据状态的数据级 diff（评审 ⑤：让「review 一批数据」有对照报告）。

典型用法：
    # 工作区 vs HEAD（最常用：merge 前后 / 采集批次落库前的人工复核）
    python3 tools/diff_data.py <(git show HEAD:data/meta.json) ...   # 不便——直接用下面两种：

    python3 tools/diff_data.py data/ shards_backup/          # 两个目录（各自 data/ 形状）
    python3 tools/diff_data.py data/ /tmp/old.json           # 目录 vs 组装产物文件
    python3 tools/diff_data.py /tmp/old.json /tmp/new.json   # 两个 JSON 文件

输入可以是 data/ 目录（经 assemble 组装）或单 JSON 文件（组装产物形状）。
输出分级：
    公司级  新增 / 删除 / 判断项变更（chain_stage、seg_profit、valuation_caveat 等）
    周期级  periods[] 按 period_id 对齐：新增 / 删除 / 字段变更（含 fx 基准变化单独标注）
    年度级  years[] 按 fy 对齐：新增 / 删除 / 字段变更
    行情    quote 逐字段对比
零业务判断：字段对比是机械 deep-diff；语义解读留给人。
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

JUDGEMENT_KEYS = ("chain_stage", "seg_profit", "valuation_caveat", "ai_profit_share",
                  "ai_share_source", "lead", "fy_note", "ticker", "region", "sector")
PERIOD_FIELDS = ("revenue", "gross_profit", "op_income", "net_income", "cfo", "capex",
                 "d_and_a", "eps_diluted", "currency", "fx_to_usd", "status",
                 "period_start", "period_end", "segment_framework")
YEAR_FIELDS = ("revenue", "gross_margin", "op_income", "net_income", "capex", "cfo", "status")


def load_state(path: str) -> dict:
    p = Path(path)
    if p.is_dir():
        # 就地组装（assemble.py 的 assemble() 固定读 ROOT/data，这里要支持任意 data/ 形状目录）
        meta = json.loads((p / "meta.json").read_text(encoding="utf-8"))
        order = meta.get("company_order") or []
        comps = {f.stem: json.loads(f.read_text(encoding="utf-8"))
                 for f in (p / "companies").glob("*.json")}
        missing = [cid for cid in order if cid not in comps]
        extra = [cid for cid in comps if cid not in order]
        if missing or extra:
            sys.exit(f"❌ {path} 的 company_order 与 companies/*.json 不一致：缺 {missing}；多 {extra}")
        return {"meta": meta, "companies": [comps[cid] for cid in order]}
    data = json.loads(p.read_text(encoding="utf-8"))
    if "companies" not in data:
        sys.exit(f"❌ {path} 既不是 data/ 目录，也不是含 companies 的 JSON 文件")
    return data


def fmt(v):
    if v is None:
        return "null"
    return json.dumps(v, ensure_ascii=False)[:60]


def diff_company(cid, old, new, out):
    # 判断项 / 头部字段
    for k in JUDGEMENT_KEYS:
        ov, nv = old.get(k), new.get(k)
        if ov != nv:
            out.append(f"    · {k}: {fmt(ov)} → {fmt(nv)}")
    # periods
    olds = {p.get("period_id"): p for p in old.get("periods", [])}
    news = {p.get("period_id"): p for p in new.get("periods", [])}
    for pid in olds.keys() - news.keys():
        out.append(f"    − period 删除: {pid}")
    for pid in news.keys() - olds.keys():
        out.append(f"    + period 新增: {pid}（{news[pid].get('period_end')} rev={fmt(news[pid].get('revenue'))}）")
    for pid in sorted(news.keys() & olds.keys()):
        o, n = olds[pid], news[pid]
        flds = []
        for k in PERIOD_FIELDS:
            if o.get(k) != n.get(k):
                tag = " [FX 基准变化]" if k == "fx_to_usd" else ""
                flds.append(f"{k}: {fmt(o.get(k))} → {fmt(n.get(k))}{tag}")
        so = {s.get("name"): s for s in o.get("segments", [])}
        sn = {s.get("name"): s for s in n.get("segments", [])}
        for sname in sn.keys() - so.keys():
            flds.append(f"segment+ {sname} rev={fmt(sn[sname].get('revenue'))}")
        for sname in so.keys() - sn.keys():
            flds.append(f"segment− {sname}")
        for sname in so.keys() & sn.keys():
            if so[sname].get("revenue") != sn[sname].get("revenue") or so[sname].get("op_income") != sn[sname].get("op_income"):
                flds.append(f"segment~ {sname}: rev {fmt(so[sname].get('revenue'))} → {fmt(sn[sname].get('revenue'))}"
                            + (f" op {fmt(so[sname].get('op_income'))} → {fmt(sn[sname].get('op_income'))}"
                               if so[sname].get("op_income") != sn[sname].get("op_income") else ""))
        if flds:
            out.append(f"    ~ period 变更: {pid}")
            out.extend(f"        {f}" for f in flds)
    # years
    oy = {y.get("fy"): y for y in old.get("years", [])}
    ny = {y.get("fy"): y for y in new.get("years", [])}
    for fy in ny.keys() - oy.keys():
        out.append(f"    + year 新增: {fy}（rev={fmt(ny[fy].get('revenue'))}）")
    for fy in oy.keys() - ny.keys():
        out.append(f"    − year 删除: {fy}")
    for fy in sorted(oy.keys() & ny.keys()):
        flds = [f"{k}: {fmt(oy[fy].get(k))} → {fmt(ny[fy].get(k))}"
                for k in YEAR_FIELDS if oy[fy].get(k) != ny[fy].get(k)]
        if flds:
            out.append(f"    ~ year 变更: {fy}")
            out.extend(f"        {f}" for f in flds)
    # quote
    oq, nq = old.get("quote") or {}, new.get("quote") or {}
    flds = [f"{k}: {fmt(oq.get(k))} → {fmt(nq.get(k))}"
            for k in ("as_of", "market_cap", "price", "net_debt", "price_currency")
            if oq.get(k) != nq.get(k)]
    if flds:
        out.append("    ~ quote 变更: " + "; ".join(flds))


def main():
    ap = argparse.ArgumentParser(description="data-level diff between two dataset states")
    ap.add_argument("old", help="旧状态：data/ 目录或组装产物 JSON")
    ap.add_argument("new", help="新状态：data/ 目录或组装产物 JSON")
    a = ap.parse_args()

    old_state, new_state = load_state(a.old), load_state(a.new)
    olds = {c["id"]: c for c in old_state["companies"]}
    news = {c["id"]: c for c in new_state["companies"]}

    out = []
    for cid in olds.keys() - news.keys():
        out.append(f"  − 公司删除: {cid}")
    for cid in news.keys() - olds.keys():
        out.append(f"  + 公司新增: {cid}")
    for cid in sorted(olds.keys() & news.keys()):
        block = []
        diff_company(cid, olds[cid], news[cid], block)
        if block:
            out.append(f"  ~ 公司变更: {cid}")
            out.extend(block)

    print("=" * 64)
    print(" 数据 diff 报告 ".center(64, "="))
    print(f" old: {a.old}（{len(olds)} 家） → new: {a.new}（{len(news)} 家）".center(64))
    print("=" * 64)
    if out:
        print("\n".join(out))
    else:
        print("（两状态数据完全一致，无差异）")
    print("-" * 64)


if __name__ == "__main__":
    main()
