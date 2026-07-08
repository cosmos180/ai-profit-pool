# Period Base Data Model Refactor Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rebuild the app around report-period base facts, then derive fiscal-year, calendar-year, TTM, latest-quarter, AI attribution, ranking, and valuation views from those facts.

**Architecture:** Keep raw reported facts immutable and source-backed in a new `periods[]` layer. Preserve the current `years[]` / `quarters[]` fields during migration, but the TTM UI consumption path is now Phase 6 final: `periods[]` > null, with no legacy fallback. `years[]` remains only for annual/valuation/forecast legacy consumers until the broader migration is separately scheduled. Views become derived projections with coverage metadata, so missing AI attribution or incomplete calendar years render as empty states instead of mixed assumptions.

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
- Phase 6 final: keep existing `ttmNetIncome(c)` only as audit-only legacy reconciliation, not as a UI fallback.

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

**Status:** Complete for the narrow TTM path. `ttmNetIncomeUnified(c)` is `periods[]` > null; `ttmNetIncome(c)` remains audit-only for historical reconciliation. `profitPoolTTM` and the migration chart no longer consume or label `legacy_fallback`.

**Precondition:**
- `legacy_fallback = 0` in the TTM pool.
- Every actual `years[]` record has `period_end_iso`, so UI selectors do not need to parse `years[].period_end` free text for year alignment.
- Snapshot tests document intentional metric changes.

**Files:**
- Modify: `data-module.js`
- Modify: `test-logic.js`
- Modify: `test-snapshot.expected.json`

**Review gate:** No selector used by UI should parse `years[].period_end` free text.

**Post-final data rule:** Until annual/valuation/AI-pool/forecast consumers migrate off `years[]`, annual actual ingestion must double-write `periods[]` annual and legacy `years[]` by `period_end_iso`; quarterly ingestion writes only `periods[]`.

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


---

## Decision Addendum (2026-07-07, 用户拍板)

本节固化用户就 implied Q4 策略与严格 CY 边界的拍板要点，作为落地契约（selector 层算不存）。

### ① Implied Q4 派生（默认策略）

`impliedQ4(c, fy)` 契约：
```
impliedQ4 = annualActual − sum(Q1, Q2, Q3)
basis:      "implied_q4"
sources:    annual.sources + Q1.sources + Q2.sources + Q3.sources
confidence: "derived_from_official"
```

**硬约束（全部满足才允许派生，否则返回 null——留空也比伪造好）：**
- 同一 `fiscal_year` 存在 `kind=annual` 且 `status=actual` 的年度期；
- 该 FY 的 `fiscal_quarter` Q1/Q2/Q3 都存在且 `kind=quarter`、`status=actual`；
- 口径一致：annual 与三个季度**同 `currency` 且同 `fx_to_usd`**（混 FX/币种口径相减无意义 → null）；
- **只对可加总流量指标**做减法：`revenue / gross_profit / op_income / net_income / cfo / capex`；某指标在 annual 或任一季缺失 → 该指标 null（逐指标诚实缺口）；
- **绝不**对 EPS / margin / AI share / 估值倍数做相减；
- 分部 Q4：仅当 annual 与 Q1–Q3 都带**同一套 segment key 集**（按 name）才逐分部推 revenue，否则 `segments: []`（绝不给部分/臆造的分部集）。
- Q4 期形状：`period_end = annual.period_end`（财年末）；`period_start = Q3.period_end + 1 天`；`calendar_year/calendar_quarter` 由 `period_end` 日期推导；`fiscal_quarter = "Q4"`。

**优先级阶梯（消费方统一遵守）：** actual reported quarter > implied Q4 > guidance > null。

**集成：**
- `calendarYear(c, year)`：仅**自然年口径**——缺 calendar Q4 而 Q1–Q3 齐时，用 annual−(fiscal Q1–3) 补，且仅当 implied 财季 Q4 恰落 calendar Q4（`iq4.calendar_quarter==="Q4"` 且落本年）。补全后 `basis="implied_q4"`、`coverage.Q4="implied_q4"`。财年错位公司的 implied 财季 Q4 不落 calendar Q4 → 不补，仍 incomplete。
- `ttmFromPeriods(c, metric)`：implied Q4 作为**真实占位季**参与连号判断，补上美股财年末系统性缺失的第四季；输出带 `basis[]`（每季 `actual|implied_q4`）与 `usedImpliedQ4`。actual Q4 优先，已占该日历季则不插 implied。
- `fiscalYearFromPeriods(c, fy)`：**不**合成 implied Q4——implied Q4 派生自 annual，而 annual 存在时 `annual_report` 分支已直接返回官方全年事实（严格优于用差值重构），故无可达缺口；阶梯 `annual_report > quarter_sum` 已包含之。

**8-K 例外触发条件：** 默认走 implied Q4；仅当公司发布独立 Q4 / 全年 8-K 且其数值与 implied 差异实质、或 implied 硬约束不满足时，才以 8-K 独立季 actual 原子取代 implied（actual 优先于 implied）。

### ② 严格 CY 边界（用户原话：「CY 视图不能只看 period_end 年份」）

`calendarYear(c, year)` 升级：
- **严格 CY**：参与的四季 `[period_start, period_end]` 连续拼接后完整覆盖 `YYYY-01-01 ~ YYYY-12-31`（端点容差 ±4 天，吸收季历末日自然浮动）→ 才标 `strict: true`；
- **财年错位公司**（NVDA 1 月末 / MSFT 6 月末 / ORCL 5 月末等）四个 fiscal 季拼不满严格覆盖 → **出 proxy 并显式标注**：`strict:false`，由 `coverage_start / coverage_end` 说清（与「灰显带原因」的产品倾向一致，label 保持纯标识 `CY####`，proxy 标注由视图据 `strict` 生成）；
- `period_start` 为 null（如 synth 路径）→ 无法验证覆盖 → 最多 proxy，不给 strict；
- 现有 `validate` 的 `calendar_year == period_end 年` 规则不变（那是原子标注，视图层负严格性）。
- 返回形状新增：`strict`（bool）、`coverage_start`、`coverage_end`、`coverage`（各现存日历季 → `actual|implied_q4`）。

### FX / 币种存储口径（三星等非 USD 源）

存储层金额均已换算为 USD bn。`currency` 记**源币**、`fx_to_usd` 记换算率。三星原子源币为 KRW、换算率 `1421.779`（与年度口径一致，见各原 source 注明「换算待核验」）→ periods 采 `currency:"KRW", fx_to_usd:1421.779`（诚实保留源币 + 已文档化汇率，满足「非 USD 必带正 fx」校验）。美光源币 USD → `currency:"USD", fx_to_usd:1`。
