# Period Base Data Model Refactor Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rebuild the app around report-period base facts, then derive fiscal-year, calendar-year, TTM, latest-quarter, AI attribution, ranking, and valuation views from those facts.

**Architecture:** Keep raw reported facts immutable and source-backed in a new `periods[]` layer. Preserve the current `years[]` / `quarters[]` fields during migration, but make new selectors prefer `periods[]` and fall back only where explicitly tested. Views become derived projections with coverage metadata, so missing AI attribution or incomplete calendar years render as empty states instead of mixed assumptions.

**Tech Stack:** JSON schema, Python validator, plain JS selector layer (`data-module.js`), Svelte UI, existing Node/Bun tests (`test-logic.js`, `test-snapshot.js`, `bun run build`).

---

## Non-Negotiable Invariants

1. Base facts are reported-period facts, not product views.
2. Every fact has provenance: source URL, `data_status`, and whether it is `official`, `guidance`, `estimate`, `consensus`, or `derived`.
3. Fiscal-year and calendar-year views are derived. Do not rewrite a company's fiscal year as a calendar year.
4. A derived calendar year is complete only when all required quarterly atoms exist for `YYYY-01-01` through `YYYY-12-31`.
5. AI attribution is never invented from labels like `primary` or `pure`. It is either sourced, derived from explicit segment facts, or null.
6. Existing app output must stay usable during migration. New code must be additive until the final cleanup phase.

---

## Target Data Shape

Add a new optional company field:

```json
"periods": [
  {
    "period_id": "samsung-2026q2-guidance",
    "kind": "quarter",
    "status": "guidance",
    "period_start": "2026-04-01",
    "period_end": "2026-06-30",
    "calendar_year": 2026,
    "calendar_quarter": "Q2",
    "fiscal_year": "FY2026",
    "fiscal_quarter": "Q2",
    "currency": "KRW",
    "fx_to_usd": 1421.779,
    "revenue": 120.27,
    "gross_profit": null,
    "op_income": 62.88,
    "net_income": null,
    "cfo": null,
    "capex": null,
    "segments": [],
    "sources": [
      {
        "label": "Samsung Q2 2026 earnings guidance",
        "url": "https://news.samsung.com/global/samsung-electronics-announces-earnings-guidance-for-second-quarter-2026",
        "data_status": "official"
      }
    ]
  }
]
```

Field rules:
- Monetary fields remain in `meta.unit` USD bn after conversion, matching the current app.
- `currency` records source currency.
- `fx_to_usd` records source-currency-per-USD when conversion was required. For USD source data, use `1`.
- `status` values: `actual`, `guidance`, `forecast`.
- `kind` values: `quarter`, `annual`.
- `segments[]` use the current segment shape, plus optional period-specific metadata only if needed.

---

## Phase 0: Freeze and Baseline

### Task 0.1: Create a baseline branch and snapshot

**Objective:** Give reviewers a clean rollback point before model changes.

**Files:** none.

**Commands:**

```bash
git status --short --branch
bun test-data-module.js
cd web && bun run build
```

Expected:
- clean worktree before starting
- logic tests pass
- snapshot tests pass
- validate reports `0 ERROR`
- build succeeds and writes root `app.html`

**Review gate:** Do not start implementation if the baseline is red.

---

## Phase 1: Schema and Validation Contract

### Task 1.1: Add `periods[]` schema

**Objective:** Allow period-base facts without breaking existing data.

**Files:**
- Modify: `schema.json`

**Implementation notes:**
- Add `company.properties.periods`.
- Add `definitions.period`.
- Keep `periods` optional.
- `additionalProperties: false` for period objects.
- Require: `period_id`, `kind`, `status`, `period_start`, `period_end`, `currency`, `sources`.
- Allow nullable financial fields.
- Allow empty `segments`.

**Tests:**

```bash
python3 -m json.tool companies.json >/tmp/companies-jsoncheck.out
python3 validate.py companies.json schema.json
```

Expected: schema still passes current data.

### Task 1.2: Add validator checks for periods

**Objective:** Catch invalid period facts early.

**Files:**
- Modify: `validate.py`

**Validation rules:**
- `period_start <= period_end`.
- `period_id` unique within company.
- `kind=quarter` must have `calendar_quarter`.
- `calendar_quarter` must be one of `Q1/Q2/Q3/Q4`.
- `calendar_year` must equal the year of `period_end` unless a company has an explicitly documented exception. Start without exceptions.
- `status=actual` with no `revenue`, `op_income`, or `net_income` should be a warning.
- `status=guidance` may omit `net_income`.
- If source currency is not USD, `fx_to_usd` must be present and positive.
- Segment revenue cannot be negative.
- Platform segment revenue must reconcile only when the period explicitly has a complete segment set; do not force reconciliation for guidance or partial-quarter segments.

**Tests:**

Add targeted synthetic tests only if validator has a test harness. If not, create temporary invalid JSON manually during review, but do not commit temp files.

**Review gate:** Validator must fail bad dates, duplicate period IDs, and missing FX for non-USD.

---

## Phase 2: Selector Layer

### Task 2.1: Add period helpers

**Objective:** Centralize period access.

**Files:**
- Modify: `data-module.js`
- Test: `test-logic.js`

**Add selectors:**

```js
periods(c)              // returns sorted periods, oldest to newest
actualPeriods(c)        // status === "actual"
quarterPeriods(c)       // kind === "quarter"
latestQuarter(c)        // latest actual quarter with at least one financial fact
periodCoverage(c, view) // returns completeness metadata
```

**Rules:**
- Prefer `c.periods` if present.
- During migration, synthesize compatible period-like objects from `quarters[]` only inside selectors where needed.
- Never parse labels for dates.

**Tests:**
- Sorted periods ignore input order.
- Guidance quarter is visible to `periods(c)` but not `latestQuarter(c)` unless the view asks for guidance.
- Missing company returns empty/null safely.

### Task 2.2: Add `calendarYear(company, year)`

**Objective:** Derive natural-year company metrics from quarterly facts.

**Files:**
- Modify: `data-module.js`
- Test: `test-logic.js`

**Contract:**

```js
calendarYear(c, 2025) => {
  label: "CY2025",
  year: 2025,
  complete: true | false,
  missing: ["Q3"],
  revenue,
  op_income,
  net_income,
  cfo,
  capex,
  sources,
  basis: "periods"
}
```

**Rules:**
- Use only `kind=quarter` and `status=actual`.
- Require Q1-Q4 for `complete=true`.
- Sum a metric only if all four quarters have that metric non-null.
- If Q1-Q4 exist but one metric is missing, return the period with `complete=false` for that metric or `metric=null`; choose one representation and test it.
- Do not include `guidance` in completed calendar-year values.

**Tests:**
- Four actual quarters sum correctly.
- Three quarters returns incomplete with missing quarter list.
- Guidance Q4 does not complete a calendar year.
- Fiscal-year-shifted company with four calendar quarters still derives correct CY.

### Task 2.3: Add `ttmFromPeriods(company, metric)`

**Objective:** Replace the current bespoke TTM path with period-base derivation.

**Files:**
- Modify: `data-module.js`
- Test: `test-logic.js`

**Rules:**
- TTM requires the latest four actual quarters with that metric non-null.
- Do not anchor TTM to `latestActual` when periods are available.
- If fewer than four quarters exist, return null and coverage metadata.
- Keep existing `ttmNetIncome(c)` behavior as fallback while migration is incomplete.

**Tests:**
- Latest four actual quarters sum.
- Guidance-only latest quarter is ignored.
- Missing metric in one quarter makes that metric null but does not crash.

### Task 2.4: Add `fiscalYearFromPeriods(company, fy)`

**Objective:** Let UI compare company-reported fiscal years via periods when available.

**Files:**
- Modify: `data-module.js`
- Test: `test-logic.js`

**Rules:**
- Sum actual quarters with matching `fiscal_year`.
- If an annual period exists with `kind=annual`, prefer it as the official full-year fact.
- Quarter-summed fiscal year is `basis="quarter_sum"`.
- Annual official fact is `basis="annual_report"`.

**Tests:**
- Annual official beats quarter sum.
- Quarter sum works when annual is missing.
- Mixed actual/guidance quarters do not produce a completed fiscal year.

---

## Phase 3: Data Migration, Small First Batch

### Task 3.1: Add periods for Samsung only

**Objective:** Prove non-SEC / Korean source workflow before touching all companies.

**Files:**
- Modify: `companies.json`
- Possibly update: `test-snapshot.expected.json`

**Scope:**
- Convert existing Samsung FY2025 annual actual into one `kind=annual` period.
- Convert existing Samsung Q1 2025 and Q1 2026 quarters into `kind=quarter` periods.
- Add Samsung Q2 2026 guidance as `kind=quarter`, `status=guidance`, `net_income=null`.
- Keep existing `years[]` and `quarters[]`.

**Verification:**

```bash
python3 validate.py companies.json schema.json
bun test-data-module.js
```

**Review gate:** `calendarYear(samsung, 2025)` must be incomplete. It must not pretend FY2025 is CY2025 unless Samsung is naturally calendar-year and the source supports it.

### Task 3.2: Add periods for Micron only

**Objective:** Prove fiscal-year-shifted company behavior.

**Files:**
- Modify: `companies.json`
- Possibly update: `test-snapshot.expected.json`

**Scope:**
- Convert existing Micron FQ1-FQ3 FY2025 and FQ1-FQ3 FY2026 quarter atoms into `periods[]`.
- Preserve existing `years[]` and `quarters[]`.

**Review gate:** `calendarYear(micron, 2025)` must not equal `FY2025`. It should be incomplete until all four calendar quarters are present.

---

## Phase 4: View Model and UI Switch

### Task 4.1: Add a view model selector

**Objective:** Keep Svelte components dumb.

**Files:**
- Modify: `data-module.js`
- Test: `test-logic.js`

**Add:**

```js
companyMetricView(c, mode, opts)
```

Supported modes:
- `latestQuarter`
- `ttm`
- `calendarYear`
- `fiscalYear`

Return shape:

```js
{
  mode,
  label,
  complete,
  coverage,
  revenue,
  op_income,
  net_income,
  aiShare,
  aiWeightedNetIncome,
  warnings: []
}
```

**Rules:**
- Missing AI share returns `aiShare=null`, `aiWeightedNetIncome=null`.
- Coverage must distinguish `missing_periods`, `missing_metric`, and `missing_ai_share`.

### Task 4.2: Add home-level view mode state

**Objective:** Let the user pick a coherent reporting lens.

**Files:**
- Modify: `web/src/components/Home.svelte`
- Modify if needed: `web/src/components/Company.svelte`
- Modify if needed: `web/src/charts/Migration.svelte`
- CSS: `web/src/app.css`

**UI modes:**
- Latest Quarter
- TTM
- Calendar Year
- Fiscal Year

**Rules:**
- Default to TTM when enough coverage exists; otherwise Latest Quarter.
- Show coverage badge: `8/14 complete`.
- Do not hide incomplete companies silently. Show muted rows with missing reason where useful.

**Review gate:** UI must make the selected reporting lens obvious in first viewport.

---

## Phase 5: Gradual Migration of All Companies

### Task 5.1: Migrate cloud companies

Companies:
- `google`
- `microsoft`
- `amazon`
- `oracle`

**Reason:** Existing quarterly data is relatively complete and official.

**Acceptance:**
- TTM from `periods[]` matches existing snapshot within rounding tolerance.
- Calendar-year view is complete only where Q1-Q4 exist.

### Task 5.2: Migrate semiconductor design and infrastructure

Companies:
- `nvda`
- `broadcom`
- `arm`

**Acceptance:**
- Fiscal-year labels remain correct.
- Latest quarter does not depend on annual `years[]`.

### Task 5.3: Migrate memory / foundry / equipment

Companies:
- `samsung`
- `micron`
- `skhynix`
- `tsmc`
- `asml`

**Acceptance:**
- Non-USD FX source is explicit.
- Calendar-year derivation never uses fiscal-year annual facts as a shortcut.

### Task 5.4: Migrate remaining non-SEC companies

Companies:
- `tencent`
- `softbank`

**Acceptance:**
- If quarterly net income is structurally noisy or unavailable, period facts still exist where possible, but TTM can remain null with explicit coverage gap.

---

## Phase 6: Deprecate Old Paths

### Task 6.1: Mark `years[]` and `quarters[]` as legacy

**Objective:** Prevent future data work from continuing the old mixed model.

**Files:**
- Modify: `schema.json`
- Modify: `docs/DATA-SPEC-dayu.md`
- Modify: `docs/DATA-SPEC-tiger.md`
- Modify: `docs/ROADMAP.md`

**Rules:**
- Do not remove old fields yet.
- Docs should say new ingestion targets `periods[]`.
- `years[]` remains display/backward-compat only until final removal.

### Task 6.2: Remove old fallback only after full coverage

**Objective:** Finish the migration cleanly.

**Precondition:**
- Every populated company has enough `periods[]` to support the app's default view.
- Snapshot tests document intentional metric changes.

**Files:**
- Modify: `data-module.js`
- Modify: `test-logic.js`
- Modify: `test-snapshot.expected.json`

**Review gate:** No selector used by UI should parse `years[].period_end` free text.

---

## Validation Commands for Every PR

Run from repo root:

```bash
python3 -m json.tool companies.json >/tmp/companies-jsoncheck.out
python3 validate.py companies.json schema.json
bun test-data-module.js
cd web && bun run build
git diff --stat
```

Expected:
- JSON valid
- schema valid
- validate has `0 ERROR`
- logic tests pass
- snapshot tests pass or snapshot diff is reviewed and intentional
- eslint and Vite build pass
- root `app.html` regenerated when web bundle/data changes

---

## Review Checklist I Will Use

For each PR, I will check:

- Does it keep raw facts separate from derived views?
- Are all new facts source-backed?
- Are fiscal and calendar periods named with exact dates?
- Does the selector return null instead of guessing?
- Does coverage metadata explain missing values?
- Does a fiscal-year-shifted company avoid CY/FY confusion?
- Does AI attribution stay sourced/proxy/null, never label-derived?
- Do tests cover guidance-only periods?
- Do tests cover incomplete calendar years?
- Does the UI disclose the active lens and coverage?
- Did the PR avoid unrelated design refactors?

---

## Open Questions for Product Decision

1. Default home lens: Latest Quarter or TTM?
2. Should guidance appear in a separate "latest guidance" lane, or only inside company detail?
3. For calendar-year incomplete companies, should the row be hidden, shown muted, or shown with last complete period?
4. For FX, do we standardize on company-disclosed average rates, Fed/H.10, or per-period source-specific rates?
5. Do we want AI attribution to be company-level only for now, or allow period-specific AI shares later?

My recommendation:
- Default home lens: TTM once coverage is acceptable, otherwise Latest Quarter.
- Guidance: show in company detail and badges, not in realized profit-pool totals.
- Incomplete companies: show muted with reason, not hidden.
- FX: company-disclosed average rate first; otherwise documented period average rate.
- AI attribution: company-level for now; period-specific later only when there are real sources.

