#!/usr/bin/env python3
"""
merge.py — 把取数工具的产物合并进 companies.json,并跑通校验/构建(与 app 解耦的收尾步骤)。

它是 fetch_fmp.py 的下游:接收「一个或多个 companies.json 形状的公司对象」,按 id
合并进 companies.json,然后强制过 validate.py;只有 0 ERROR 才写盘并构建(cd web && bun run build)。
任何一步失败都会回滚 companies.json,保证仓库里的数据永远是校验通过的状态。

    # 直接接管道:取数 → 合并 → 校验 → 构建,一条龙
    python3 tools/fetch_fmp.py NVDA MSFT ORCL AMD | python3 tools/merge.py -

    # 或先落文件再合并
    python3 tools/fetch_fmp.py NVDA --out /tmp/nvda.json
    python3 tools/merge.py /tmp/nvda.json

    python3 tools/merge.py /tmp/a.json /tmp/b.json     # 多个文件一起并
    python3 tools/merge.py /tmp/new.json --dry-run     # 只看会改动谁,不写盘
    python3 tools/merge.py /tmp/new.json --no-build     # 合并+校验,但先不重建 app.html

合并规则:同 id → 覆盖(并提示);新 id → 追加。判断项(chain_stage / segments[].is_ai
等)工具给不了 —— 覆盖已有公司时若新对象没有这些字段,会用旧对象里的值补上,避免手工
补录的判断项被一次取数冲掉。
"""
import argparse, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "companies.json"
SCHEMA = ROOT / "schema.json"

# 工具给不出、需人工补录的判断项:覆盖同 id 公司时,若新对象缺这些,则保留旧值。
JUDGEMENT_KEYS = ("chain_stage", "ai_exposure", "ai_profit_share", "ai_revenue_share",
                  "ai_share_source", "seg_profit", "valuation_caveat", "logo_text",
                  "logo_class", "lead", "fy_note")


def load_objs(paths):
    objs = []
    for p in paths:
        raw = sys.stdin.read() if p == "-" else Path(p).read_text(encoding="utf-8")
        data = json.loads(raw)
        objs.extend(data if isinstance(data, list) else [data])
    return objs


def merge_year_segments(old_c, new_c):
    """按 period_end_iso 对齐,用旧年份里手工补的 segments 补回新年份的空 segments。"""
    old_years = {y.get("period_end_iso"): y for y in old_c.get("years", []) if y.get("period_end_iso")}
    for y in new_c.get("years", []):
        oy = old_years.get(y.get("period_end_iso"))
        if oy and not y.get("segments") and oy.get("segments"):
            y["segments"] = oy["segments"]
    return new_c


def main():
    ap = argparse.ArgumentParser(description="merge fetched company object(s) into companies.json")
    ap.add_argument("inputs", nargs="+", metavar="FILE", help="取数产物;用 - 读 stdin")
    ap.add_argument("--dry-run", action="store_true", help="只报告会改动谁,不写盘")
    ap.add_argument("--no-build", action="store_true", help="合并+校验后不构建 app.html")
    a = ap.parse_args()

    db = json.loads(DB.read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in db["companies"]}
    new_objs = load_objs(a.inputs)
    if not new_objs:
        sys.exit("no company objects to merge")

    added, updated = [], []
    for c in new_objs:
        cid = c.get("id")
        if not cid:
            sys.exit(f"每个对象都要有 id(取数工具会自动填);缺 id 的对象: {c.get('name')}")
        if cid in by_id:
            old = by_id[cid]
            for k in JUDGEMENT_KEYS:            # 保留手工补的判断项
                if k not in c and k in old:
                    c[k] = old[k]
            merge_year_segments(old, c)         # 保留手工补的 segments
            updated.append(cid)
        else:
            added.append(cid)
        by_id[cid] = c

    if a.dry_run:
        print(f"[dry-run] 追加: {added or '—'}")
        print(f"[dry-run] 覆盖: {updated or '—'}(会保留其判断项/segments)")
        print(f"[dry-run] 合并后共 {len(by_id)} 家;未写盘。")
        return

    # 备份 → 写盘 → 校验;失败则回滚,保证仓库永远是校验通过的数据。
    backup = DB.read_text(encoding="utf-8")
    db["companies"] = list(by_id.values())
    DB.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    r = subprocess.run([sys.executable, str(ROOT / "validate.py"), str(DB), str(SCHEMA)])
    if r.returncode != 0:
        DB.write_text(backup, encoding="utf-8")
        sys.exit("\n❌ 校验未通过 → 已回滚 companies.json(未改动)。修好取数/判断项后重试。")

    print(f"\n✅ 合并完成:追加 {len(added)}、覆盖 {len(updated)},共 {len(by_id)} 家,校验 0 ERROR。")
    if added:   print(f"   追加: {', '.join(added)}")
    if updated: print(f"   覆盖: {', '.join(updated)}")

    if a.no_build:
        print("   (--no-build) 记得随后跑 `cd web && bun run build` 重建 app.html。")
        return
    # 视图层已迁到 Svelte+Vite:构建 = web/ 里的 bun run build(会再跑一次校验闸门,冗余但无害)。
    try:
        b = subprocess.run(["bun", "run", "build"], cwd=str(ROOT / "web"))
    except FileNotFoundError:
        print("   ⚠ 未找到 bun —— companies.json 已更新且校验通过。"
              "装好依赖后手动跑 `cd web && bun install && bun run build` 重建 app.html。")
        return
    if b.returncode != 0:
        sys.exit("web 构建失败 —— companies.json 已更新且校验通过,手动排查 `cd web && bun run build`。")
    print("   app.html 已重建(cd web && bun run build)→ 打开即可看到新数据。")

    # 温馨提示:未补判断项的公司会honest降级(不进 AI 利润池/迁移图)。
    missing = [cid for cid in (added + updated)
               if not by_id[cid].get("chain_stage")
               or not any(s.get("is_ai") for y in by_id[cid].get("years", []) for s in y.get("segments", []))]
    if missing:
        print(f"\n⚠ 以下公司缺 chain_stage 或 is_ai 分部,暂不参与利润池迁移/AI 加权池"
              f"(其余页面正常显示): {', '.join(missing)}")


if __name__ == "__main__":
    main()
