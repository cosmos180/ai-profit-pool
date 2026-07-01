#!/usr/bin/env python3
"""
fetch_fmp.py — decoupled data collector (Financial Modeling Prep → companies.json shape).

Standalone helper. It does NOT touch the app (data-module/build/view); it only
turns FMP's structured financials into a company object matching schema.json, so
you can paste the result into companies.json[companies] and run validate.py.

    export FMP_API_KEY=xxxx
    python3 tools/fetch_fmp.py NVDA --id nvda --name "NVIDIA 英伟达" --years 4 --quarters
    python3 tools/fetch_fmp.py MSFT > /tmp/msft.json

What it fills automatically (from FMP, per project invariant "raw facts only,
derived computed at read time" — so NO margins/ratios are written, only raw):
  revenue, net_income, op_income, gross_margin*, capex, cfo, quote.market_cap,
  quote.price, quote.net_debt, years[].period_end(_iso), optional quarters[].
  (*gross_margin is a raw disclosed ratio in this schema, kept as reported.)

What it CANNOT know — left as null/placeholder for your human judgement
(exactly the human-in-the-loop fields the project keeps out of any API):
  chain_stage, ai_exposure, ai_profit_share, segments[].is_ai, valuation_caveat.

Honesty rules it follows:
  - Missing FMP field -> left null (never fabricated / never 0).
  - Every value carries an FMP source URL with data_status "derived"
    (FMP is an aggregator, not the primary filing — mark it honestly; upgrade to
    "official" yourself after checking the 10-K/20-F).
  - Values are divided by 1e9 into the project's USD bn unit. If the company does
    NOT report in USD, the numbers are in LOCAL-currency bn and the object is
    tagged `_fx_todo` — you must convert to USD bn before committing.
"""
import argparse, json, os, sys, urllib.request, urllib.error, urllib.parse

BASE = "https://financialmodelingprep.com"


def _get(path, key, params=None):
    """GET an FMP endpoint, return parsed JSON (list/dict) or None on failure."""
    q = dict(params or {}); q["apikey"] = key
    url = f"{BASE}{path}?" + urllib.parse.urlencode(q)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"  ! HTTP {e.code} on {path} (plan may not cover this endpoint)", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  ! error on {path}: {e}", file=sys.stderr)
        return None
    if isinstance(data, dict) and data.get("Error Message"):
        print(f"  ! FMP: {data['Error Message']}", file=sys.stderr)
        return None
    return data


def bn(v):
    """USD bn, rounded to 4 dp; None-safe (missing stays missing)."""
    return round(v / 1e9, 4) if isinstance(v, (int, float)) else None


def src(label, url):
    return {"label": label, "url": url, "data_status": "derived"}


def build(ticker, key, n_years, want_quarters):
    sym = ticker.upper()
    prof = _get(f"/api/v3/profile/{sym}", key)
    prof = prof[0] if isinstance(prof, list) and prof else {}
    inc = _get(f"/api/v3/income-statement/{sym}", key, {"period": "annual", "limit": n_years}) or []
    bal = _get(f"/api/v3/balance-sheet-statement/{sym}", key, {"period": "annual", "limit": n_years}) or []
    cf  = _get(f"/api/v3/cash-flow-statement/{sym}", key, {"period": "annual", "limit": n_years}) or []
    quote = _get(f"/api/v3/quote/{sym}", key)
    quote = quote[0] if isinstance(quote, list) and quote else {}

    if not inc:
        print(f"  ! no income statement returned for {sym} — check ticker / plan.", file=sys.stderr)
        return None

    ccy = (inc[0].get("reportedCurrency") or prof.get("currency") or "USD").upper()
    bal_by = {b.get("calendarYear"): b for b in bal}
    cf_by  = {c.get("calendarYear"): c for c in cf}
    inc_url = f"{BASE}/api/v3/income-statement/{sym}"
    cf_url  = f"{BASE}/api/v3/cash-flow-statement/{sym}"

    years = []
    for row in reversed(inc):  # FMP returns newest-first; store ascending
        cy = row.get("calendarYear"); d = row.get("date")
        c = cf_by.get(cy, {})
        capex = c.get("capitalExpenditure")
        y = {
            "fy": f"FY{cy}" if cy else None,
            "period_end": f"截至 {d}" if d else None,
            "period_end_iso": d,
            "status": "actual",
            "revenue": bn(row.get("revenue")),
            "gross_margin": (round(row["grossProfit"] / row["revenue"], 4)
                             if row.get("grossProfit") and row.get("revenue") else None),
            "op_income": bn(row.get("operatingIncome")),
            "net_income": bn(row.get("netIncome")),
            "capex": bn(abs(capex)) if isinstance(capex, (int, float)) else None,
            "cfo": bn(c.get("operatingCashFlow") or c.get("netCashProvidedByOperatingActivities")),
            "segments": [],  # TODO: fill + tag is_ai by hand (drives AI-share proxy)
            "sources": [src(f"FMP income statement ({sym}, FY{cy})", inc_url),
                        src(f"FMP cash-flow statement ({sym}, FY{cy})", cf_url)],
        }
        years.append(y)

    b0 = bal[0] if bal else {}
    quote_obj = {
        "as_of": quote.get("date") or None,   # FMP quote 'date' may be a timestamp; set your snapshot date
        "market_cap": bn(quote.get("marketCap")),
        "net_debt": bn(b0.get("netDebt")),     # FMP: totalDebt − cash&STI; +=net debt, −=net cash
        "price": quote.get("price"),
        "price_currency": ccy,
        "sources": [src(f"FMP quote ({sym})", f"{BASE}/api/v3/quote/{sym}"),
                    src(f"FMP balance sheet ({sym})", f"{BASE}/api/v3/balance-sheet-statement/{sym}")],
    }

    company = {
        "id": None, "name": prof.get("companyName") or sym,
        "ticker": f"{prof.get('exchangeShortName','')} · {sym}".strip(" ·"),
        "region": prof.get("country") or None,
        "sector": prof.get("sector") or None,
        "currency": ccy,
        "chain_stage": None,      # TODO: your value-chain stage (meta.stages key)
        "ai_exposure": None,      # TODO: pure|primary|partial|peripheral
        "seg_profit": "no",       # TODO: yes|partial|no per disclosure
        "status": "populated",
        "quote": quote_obj,
        "years": years,
    }

    if want_quarters:
        q = _get(f"/api/v3/income-statement/{sym}", key, {"period": "quarter", "limit": 8}) or []
        qs = []
        for row in reversed(q):
            d = row.get("date")
            qs.append({
                "period_end": d, "period_end_iso": d,
                "label": f"{row.get('period','')} {row.get('calendarYear','')}".strip(),
                "net_income": bn(row.get("netIncome")),
                "revenue": bn(row.get("revenue")),
                "sources": [src(f"FMP quarterly ({sym})", inc_url)],
            })
        if qs:
            company["quarters"] = qs

    company["_notes"] = [
        "AUTO-FILLED FROM FMP (data_status=derived). Verify against primary filings; upgrade to 'official'.",
        "FILL BY HAND: chain_stage, ai_exposure, seg_profit, segments[]+is_ai, valuation_caveat, id.",
    ]
    if ccy != "USD":
        company["_fx_todo"] = (f"Values are in {ccy} bn, NOT USD bn. Convert every number to USD bn "
                               f"(project unit) before committing; note the FX rate in sources.")
    return company


def main():
    ap = argparse.ArgumentParser(description="FMP → companies.json company object (decoupled collector).")
    ap.add_argument("ticker")
    ap.add_argument("--id", help="lowercase id to set (default: leave null for you to fill)")
    ap.add_argument("--name", help="override display name")
    ap.add_argument("--years", type=int, default=4)
    ap.add_argument("--quarters", action="store_true", help="also pull latest quarters (for TTM)")
    ap.add_argument("--key", default=os.environ.get("FMP_API_KEY"))
    ap.add_argument("--out", help="write to file instead of stdout")
    a = ap.parse_args()
    if not a.key:
        sys.exit("Set FMP_API_KEY env var or pass --key")

    print(f"Fetching {a.ticker.upper()} from FMP…", file=sys.stderr)
    obj = build(a.ticker, a.key, a.years, a.quarters)
    if not obj:
        sys.exit(1)
    if a.id:   obj["id"] = a.id
    if a.name: obj["name"] = a.name

    out = json.dumps(obj, ensure_ascii=False, indent=2)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(out + "\n")
        print(f"wrote {a.out}", file=sys.stderr)
    else:
        print(out)
    # brief coverage summary to stderr
    filled = sum(1 for y in obj["years"] for k in ("revenue","net_income","op_income","capex","cfo") if y.get(k) is not None)
    print(f"done: {len(obj['years'])} years, {filled} core numbers filled, currency={obj['currency']}"
          + ("  ⚠ non-USD, see _fx_todo" if obj.get("_fx_todo") else ""), file=sys.stderr)


if __name__ == "__main__":
    main()
