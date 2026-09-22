#!/usr/bin/env python3
"""
assemble.py — 数据分片的组装器（评审 ④：一司一文件，构建期拼装）。

真相源 = data/meta.json + data/companies/<id>.json（每司一文件，数据批次只碰自己的
文件，review 隔离、git diff 干净）。companies.json 退化为【构建/测试产物】（gitignore，
由本工具再生）——与 app.html 同一地位的 artifact。

用法：
    python3 tools/assemble.py                  # 打印组装结果 JSON（管道/调试）
    python3 tools/assemble.py --out FILE       # 写文件（如 --out companies.json）

规则：
    · 公司顺序 = data/meta.json 的 company_order（显式清单，缺一/多一都报错）；
    · 每个公司文件必须是单对象（dict）；id 必须与文件名一致；
    · 组装只做拼接与顺序，零校验（校验归 validate.py——它消费本工具的输出）。
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
COMPANIES = DATA / "companies"


class AssembleError(Exception):
    pass


def assemble() -> dict:
    if not DATA.is_dir() or not COMPANIES.is_dir():
        raise AssembleError("data/ 或 data/companies/ 不存在——先按 README 分片（或从历史 companies.json 迁移）")
    meta = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
    order = meta.get("company_order")
    if not isinstance(order, list) or not order:
        raise AssembleError("data/meta.json 缺 company_order（显式公司顺序清单）")

    files = {p.stem: p for p in COMPANIES.glob("*.json")}
    missing = [cid for cid in order if cid not in files]
    extra = [cid for cid in files if cid not in order]
    if missing or extra:
        raise AssembleError(
            f"company_order 与 data/companies/*.json 不一致：缺 {missing}；多 {extra}"
        )

    companies = []
    for cid in order:
        obj = json.loads(files[cid].read_text(encoding="utf-8"))
        if not isinstance(obj, dict) or obj.get("id") != cid:
            raise AssembleError(f"data/companies/{cid}.json 的 id 字段与文件名不一致")
        companies.append(obj)

    return {"meta": meta, "companies": companies}


def main():
    ap = argparse.ArgumentParser(description="assemble data/ shards into one dataset")
    ap.add_argument("--out", default=None, help="写出到文件（缺省打印到 stdout）")
    args = ap.parse_args()
    try:
        dataset = assemble()
    except AssembleError as e:
        print(f"❌ 组装失败：{e}", file=sys.stderr)
        sys.exit(1)
    text = json.dumps(dataset, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"assembled {len(dataset['companies'])} companies → {args.out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
