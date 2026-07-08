#!/usr/bin/env python3
"""
merge.py — 把取数工具的产物合并进 companies.json,并跑通校验/构建(与 app 解耦的收尾步骤)。

它是 fetch_fmp.py / Dayu / 人工提取的下游:接收「一个或多个 companies.json 形状的公司对象」,
按 id 合并进 companies.json,然后强制过 validate.py;只有 0 ERROR 才写盘并构建(cd web && bun run build)。
任何一步失败都会回滚 companies.json,保证仓库里的数据永远是校验通过的状态。

    # 直接接管道:取数 → 合并 → 校验 → 构建,一条龙
    python3 tools/fetch_fmp.py NVDA MSFT ORCL AMD | python3 tools/merge.py -

    # 或先落文件再合并
    python3 tools/fetch_fmp.py NVDA --out /tmp/nvda.json
    python3 tools/merge.py /tmp/nvda.json

    python3 tools/merge.py /tmp/a.json /tmp/b.json     # 多个文件一起并
    python3 tools/merge.py /tmp/new.json --dry-run     # 只看会改动谁,不写盘
    python3 tools/merge.py /tmp/new.json --no-build     # 合并+校验,但先不重建 app.html

── 两种合并模式(按对象形状自动判定)────────────────────────────────────────
【完整对象】含 `years` 且未显式 `"_partial": true` → 整对象覆盖(现行行为,零变更):
    同 id → 覆盖(判断项/segments 由覆盖保护保留);新 id → 追加。

【部分对象】缺 `years`,或显式带 `"_partial": true` → **部分合并**(只更新提供的顶层键):
    - 只能更新【已存在】的公司(部分对象无法整录一家新公司 → 报错);
    - `periods` 按 `period_id` 增量并入(同 id 替换该条 / 新 id 追加 / 其余不动),并入后按 period_end 排序;
    - `quarters` 按 `period_end`、`years` 按 `period_end_iso` 同理增量并入;
    - `quote` 及其余顶层键 → 整体替换该键;
    - **未提供的键一律保留旧值** —— 吐 quote-only / periods-only 的部分对象不会冲毁公司其余数据。
  设计取舍:以「缺 years」作为部分对象的默认信号,是为了拒绝静默整替换(旧流程里 quote-only
  会把 years/quarters/periods 全冲掉);需要对 years 本身做增量时,显式带 `"_partial": true` 即可。

合并规则(完整对象):同 id → 覆盖(并提示);新 id → 追加。判断项(chain_stage / segments[].is_ai
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

# 部分合并里按「数组元素键」增量并入的顶层键 → (元素主键字段, 排序字段)。
INCREMENTAL_ARRAYS = {
    "periods":  ("period_id", "period_end"),
    "quarters": ("period_end", "period_end"),
    "years":    ("period_end_iso", "period_end_iso"),
}


class MergeError(Exception):
    """人话报错;在 main 里转成 sys.exit,不吐 traceback。"""


def load_objs(paths):
    objs = []
    for p in paths:
        raw = sys.stdin.read() if p == "-" else Path(p).read_text(encoding="utf-8")
        label = "stdin" if p == "-" else p
        if not raw.strip():
            # 上游取数失败时管道会喂进空输入(如 fetch_fmp 全 402)——给人话而非 JSON traceback。
            sys.exit(f"{label} 没有 JSON 输入；上游取数可能失败或没有返回公司对象。companies.json 未改动。")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            sys.exit(f"{label} 不是合法 JSON：{e.msg} (line {e.lineno}, column {e.colno})。companies.json 未改动。")
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


def is_partial(obj):
    """部分对象 = 显式 _partial:true,或(默认信号)缺 years。"""
    return obj.get("_partial") is True or "years" not in obj


def merge_array(cid, key, old_list, new_list, key_field, sort_field):
    """按 key_field 增量并入:同键替换、新键追加、其余不动;并入后按 sort_field 排序。
    返回 (merged_list, replaced, appended)。坏输入(缺键/键重复)抛人话错误。"""
    if not isinstance(new_list, list):
        raise MergeError(f"{cid} 的 `{key}` 必须是数组,收到 {type(new_list).__name__}。")
    idx = {}
    for i, item in enumerate(old_list):
        k = item.get(key_field)
        if k is not None:
            idx[k] = i
    merged = list(old_list)
    seen, replaced, appended = set(), 0, 0
    for item in new_list:
        if not isinstance(item, dict):
            raise MergeError(f"{cid} 的 `{key}` 元素必须是对象,收到 {type(item).__name__}。")
        k = item.get(key_field)
        if k is None:
            raise MergeError(f"{cid} 的 `{key}` 有元素缺 `{key_field}`,无法增量并入(每条都要有 `{key_field}`)。")
        if k in seen:
            raise MergeError(f"{cid} 的 `{key}` 输入里 `{key_field}` 重复:{k!r} —— 一次并入内不允许同键多条(请去重后重试)。")
        seen.add(k)
        if k in idx:
            merged[idx[k]] = item
            replaced += 1
        else:
            merged.append(item)
            appended += 1
    merged.sort(key=lambda x: (x.get(sort_field) is None, x.get(sort_field)))
    return merged, replaced, appended


def apply_partial(old, new):
    """把部分对象 new 就地并入 old,只动 new 提供的顶层键。返回改动摘要 dict。"""
    cid = old["id"]
    changes = {}
    for key, val in new.items():
        if key in ("id", "_partial"):
            continue
        if key in INCREMENTAL_ARRAYS:
            key_field, sort_field = INCREMENTAL_ARRAYS[key]
            merged, replaced, appended = merge_array(cid, key, old.get(key, []), val, key_field, sort_field)
            old[key] = merged
            changes[key] = f"{key}: 替换 {replaced} / 新增 {appended}(共 {len(merged)})"
        else:
            existed = key in old
            old[key] = val
            changes[key] = f"{key}: {'替换' if existed else '新增'}"
    if not changes:
        raise MergeError(f"{cid} 是部分对象但没有可更新的顶层键(除 id/_partial 外为空)。")
    return changes


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

    added, updated, partials = [], [], []   # partials: (cid, changes_dict)
    try:
        for c in new_objs:
            cid = c.get("id")
            if not cid:
                raise MergeError(f"每个对象都要有 id(取数工具会自动填);缺 id 的对象: {c.get('name')}")
            partial = is_partial(c)
            if cid in by_id:
                old = by_id[cid]
                if partial:
                    changes = apply_partial(old, c)     # 就地增量并入(只动提供的键)
                    partials.append((cid, changes))
                else:
                    for k in JUDGEMENT_KEYS:            # 保留手工补的判断项
                        if k not in c and k in old:
                            c[k] = old[k]
                    merge_year_segments(old, c)         # 保留手工补的 segments
                    updated.append(cid)
                    by_id[cid] = c
            else:
                if partial:
                    raise MergeError(
                        f"{cid} 是部分对象(缺 years 或带 _partial),但 companies.json 里没有这个 id —— "
                        f"部分合并只能更新已存在的公司。先用【完整对象】录入这家公司。")
                added.append(cid)
                by_id[cid] = c
    except MergeError as e:
        sys.exit(f"❌ {e}\ncompanies.json 未改动。")

    if a.dry_run:
        print(f"[dry-run] 追加(新公司): {added or '—'}")
        print(f"[dry-run] 整对象覆盖: {updated or '—'}(会保留其判断项/segments)")
        if partials:
            print("[dry-run] 部分更新(只动提供的键):")
            for cid, ch in partials:
                print(f"    {cid} —— " + "; ".join(ch.values()))
        else:
            print("[dry-run] 部分更新: —")
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

    print(f"\n✅ 合并完成:追加 {len(added)}、覆盖 {len(updated)}、部分更新 {len(partials)},"
          f"共 {len(by_id)} 家,校验 0 ERROR。")
    if added:    print(f"   追加: {', '.join(added)}")
    if updated:  print(f"   覆盖: {', '.join(updated)}")
    if partials:
        for cid, ch in partials:
            print(f"   部分更新 {cid}: " + "; ".join(ch.values()))

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
    touched = added + updated + [cid for cid, _ in partials]
    missing = [cid for cid in touched
               if not by_id[cid].get("chain_stage")
               or not any(s.get("is_ai") for y in by_id[cid].get("years", []) for s in y.get("segments", []))]
    if missing:
        print(f"\n⚠ 以下公司缺 chain_stage 或 is_ai 分部,暂不参与利润池迁移/AI 加权池"
              f"(其余页面正常显示): {', '.join(missing)}")


if __name__ == "__main__":
    main()
