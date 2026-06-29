#!/usr/bin/env python3
"""Build the standalone app.html from the HTML template, data, and data module."""
import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "app.template.html"
DATA = ROOT / "companies.json"
DATA_MODULE = ROOT / "data-module.js"
OUTPUT = ROOT / "app.html"


def render():
    html = TEMPLATE.read_text(encoding="utf-8")
    module = DATA_MODULE.read_text(encoding="utf-8").strip()
    dataset = DATA.read_text(encoding="utf-8").strip()

    if "/*__DATA_MODULE__*/" not in html:
        raise SystemExit("missing data module placeholder in app.template.html")
    if "__DATASET_JSON__" not in html:
        raise SystemExit("missing dataset placeholder in app.template.html")

    html = html.replace("/*__DATA_MODULE__*/", module)
    html = html.replace("__DATASET_JSON__", dataset)
    return html


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify app.html is up to date without rewriting it")
    args = parser.parse_args()

    html = render()

    if args.check:
        if not OUTPUT.exists():
            print(f"{OUTPUT.name} does not exist", file=sys.stderr)
            raise SystemExit(1)
        current = OUTPUT.read_text(encoding="utf-8")
        if current != html:
            print(f"{OUTPUT.name} is out of date; run python3 build.py", file=sys.stderr)
            raise SystemExit(1)
        print(f"{OUTPUT.name} is up to date ({len(html.encode('utf-8'))} bytes)")
        return

    OUTPUT.write_text(html, encoding="utf-8")
    print(f"built {OUTPUT.name} ({len(html.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
