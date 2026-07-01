#!/usr/bin/env python3
"""
fetch_fmp.py — decoupled data collector (Financial Modeling Prep → companies.json shape).

Standalone helper. It does NOT touch the app (data-module/build/view); it only
turns FMP's structured financials into a company object matching schema.json, so
you can paste the result into companies.json[companies] and run validate.py.

    export FMP_API_KEY=xxxx
    python3 tools/fetch_fmp.py NVDA                 # id=nvda, name=FMP's, auto
    python3 tools/fetch_fmp.py NVDA MSFT ORCL AMD   # batch → JSON array
    python3 tools/fetch_fmp.py MSFT --out /tmp/msft.json

API: defaults to FMP's current "stable" API (…/stable/income-statement?symbol=SYM).
Newer keys only work on stable; older keys may need the legacy v3 API — pass
`--legacy` if stable returns 403 for your plan.

What it fills automatically (raw facts only — per the project invariant, NO
ratios are stored except the disclosed gross_margin):
  revenue, net_income, op_income, gross_margin, capex, cfo, quote.market_cap,
  quote.price, quote.net_debt, years[].period_end(_iso), optional quarters[].

What it CANNOT know — left null/placeholder for your human judgement:
  chain_stage, ai_exposure, ai_profit_share, segments[].is_ai, valuation_caveat.

Honesty rules it follows:
  - Missing FMP field -> left null (never fabricated / never 0).
  - Every value carries an FMP source URL with data_status "derived" (FMP is an
    aggregator, not the primary filing — upgrade to "official" after checking it).
  - Values are ÷1e9 into the project's USD bn unit. If the company does not report
    in USD, numbers are LOCAL-currency bn and the object is tagged `_fx_todo` —
    convert to USD bn before committing.
"""
import argparse, json, os, sys, urllib.request, urllib.error, urllib.parse
from datetime import date

BASE = "https://financialmodelingprep.com"


def ep(mode, name, sym, params=None):
    """Return (path, params) for stable (?symbol=) or legacy v3 (/SYM path)."""
    params = dict(params or {})
    if mode == "v3":
        return f"/api/v3/{name}/{sym}", params
    params["symbol"] = sym
    return f"/stable/{name}", params


def disp_url(mode, name, sym):
    """Human-facing source URL (no key)."""
    return f"{BASE}/stable/{name}?symbol={sym}" if mode != "v3" else f"{BASE}/api/v3/{name}/{sym}"


def _get(path, key, params=None):
    """GET an FMP endpoint, return parsed JSON (list/dict) or None on failure."""
    q = dict(params or {}); q["apikey"] = key
    url = f"{BASE}{path}?" + urllib.parse.urlencode(q)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        hint = {403: " (try --legacy for the v3 API, or check your plan)",
                402: " (this endpoint needs a higher FMP tier — e.g. quarterly statements)"}.get(e.code, "")
        print(f"  ! HTTP {e.code} on {path}{hint}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  ! error on {path}: {e}", file=sys.stderr)
        return None
    if isinstance(data, dict) and (data.get("Error Message") or data.get("error")):
        print(f"  ! FMP: {data.get('Error Message') or data.get('error')}", file=sys.stderr)
        return None
    return data


def bn(v):
    """USD bn, rounded to 4 dp; None-safe (missing stays missing)."""
    return round(v / 1e9, 4) if isinstance(v, (int, float)) else None


def src(label, url):
    return {"label": label, "url": url, "data_status": "derived"}


def build(ticker, key, n_years, want_quarters, mode):
    sym = ticker.upper()

    def fetch(name, params=None):
        p, pr = ep(mode, name, sym, params)
        return _get(p, key, pr)

    prof = fetch("profile"); prof = prof[0] if isinstance(prof, list) and prof else (prof or {})
    inc = fetch("income-statement", {"period": "annual", "limit": n_years}) or []
    bal = fetch("balance-sheet-statement", {"period": "annual", "limit": n_years}) or []
    cf  = fetch("cash-flow-statement", {"period": "annual", "limit": n_years}) or []
    quote = fetch("quote"); quote = quote[0] if isinstance(quote, list) and quote else (quote or {})

    if not inc:
        print(f"  ! no income statement for {sym} — check ticker / plan"
              + ("" if mode == "v3" else " (or run with --legacy)"), file=sys.stderr)
        return None

    ccy = (inc[0].get("reportedCurrency") or prof.get("currency") or "USD").upper()
    cf_by = {c.get("calendarYear") or (c.get("date") or "")[:4]: c for c in cf}
    inc_url = disp_url(mode, "income-statement", sym)
    cf_url  = disp_url(mode, "cash-flow-statement", sym)

    years = []
    for row in reversed(inc):  # FMP returns newest-first; store ascending
        cy = row.get("calendarYear") or (row.get("date") or "")[:4]
        d = row.get("date")
        c = cf_by.get(cy, {})
        capex = c.get("capitalExpenditure")
        years.append({
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
        })

    b0 = bal[0] if bal else {}
    # net_debt in OUR 口径 = 有息债务 − (现金 + 短期投资). FMP's own `netDebt` field only
    # subtracts cash&equivalents (NOT short-term investments), which badly misreads
    # companies that park cash in STI (e.g. NVDA → false net debt). Recompute from parts.
    td, csti = b0.get("totalDebt"), b0.get("cashAndShortTermInvestments")
    if isinstance(td, (int, float)) and isinstance(csti, (int, float)):
        net_debt = bn(td - csti)
    else:
        net_debt = bn(b0.get("netDebt"))       # fallback (understates net cash)
    quote_obj = {
        "as_of": date.today().isoformat(),     # FMP quote price is LIVE → snapshot = run date
        "market_cap": bn(quote.get("marketCap")),
        "net_debt": net_debt,                  # +=net debt, −=net cash
        "price": quote.get("price"),
        "price_currency": ccy,
        "sources": [src(f"FMP quote ({sym})", disp_url(mode, "quote", sym)),
                    src(f"FMP balance sheet ({sym})", disp_url(mode, "balance-sheet-statement", sym))],
    }

    company = {
        "id": None, "name": prof.get("companyName") or sym,
        "ticker": f"{prof.get('exchangeShortName','')} · {sym}".strip(" ·"),
        "region": prof.get("country") or None,
        "sector": prof.get("sector") or None,
        "currency": ccy,
        "chain_stage": None,      # TODO: value-chain stage (meta.stages key)
        "ai_exposure": None,      # TODO: pure|primary|partial|peripheral
        "seg_profit": "no",       # TODO: yes|partial|no per disclosure
        "status": "populated",
        "quote": quote_obj,
        "years": years,
    }

    if want_quarters:
        q = fetch("income-statement", {"period": "quarter", "limit": 8}) or []
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
        "AUTO-FILLED FROM FMP (data_status=derived). Verify vs primary filings; upgrade to 'official'.",
        "FILL BY HAND: chain_stage, ai_exposure, seg_profit, segments[]+is_ai, valuation_caveat, id.",
    ]
    if ccy != "USD":
        company["_fx_todo"] = (f"Values are in {ccy} bn, NOT USD bn. Convert every number to USD bn "
                               f"before committing; note the FX rate in sources.")
    return company


def main():
    ap = argparse.ArgumentParser(
        description="FMP → companies.json company object(s). id defaults to ticker.lower(), "
                    "name to FMP's company name — so the minimal call is just the ticker(s).")
    ap.add_argument("tickers", nargs="+", metavar="TICKER", help="one or more, e.g. NVDA MSFT ORCL")
    ap.add_argument("--id", help="override id (only when a single ticker is given; else auto = ticker.lower())")
    ap.add_argument("--name", help="override name (single ticker; else auto = FMP company name)")
    ap.add_argument("--years", type=int, default=4)
    ap.add_argument("--quarters", action="store_true", help="also pull latest quarters (for TTM; needs a higher FMP tier)")
    ap.add_argument("--legacy", action="store_true", help="use the legacy /api/v3 API instead of /stable")
    ap.add_argument("--key", default=os.environ.get("FMP_API_KEY"))
    ap.add_argument("--out", help="write to file instead of stdout")
    a = ap.parse_args()
    if not a.key:
        sys.exit("Set FMP_API_KEY env var or pass --key")

    mode = "v3" if a.legacy else "stable"
    single = len(a.tickers) == 1
    results = []
    for tk in a.tickers:
        print(f"Fetching {tk.upper()} from FMP ({mode} API)…", file=sys.stderr)
        obj = build(tk, a.key, a.years, a.quarters, mode)
        if not obj:
            print(f"  ! skipped {tk.upper()}", file=sys.stderr)
            continue
        obj["id"] = (a.id if (a.id and single) else tk.lower())   # auto id from ticker
        if a.name and single:
            obj["name"] = a.name                                   # else keep FMP company name
        filled = sum(1 for y in obj["years"] for k in ("revenue", "net_income", "op_income", "capex", "cfo")
                     if y.get(k) is not None)
        print(f"  {obj['id']}: {len(obj['years'])} years, {filled} core numbers, currency={obj['currency']}"
              + ("  ⚠ non-USD, see _fx_todo" if obj.get("_fx_todo") else ""), file=sys.stderr)
        results.append(obj)

    if not results:
        sys.exit(1)
    payload = results[0] if (single and results) else results      # single→object, many→array
    out = json.dumps(payload, ensure_ascii=False, indent=2)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(out + "\n")
        print(f"wrote {a.out} ({len(results)} companies)", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
