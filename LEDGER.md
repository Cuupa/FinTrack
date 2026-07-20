# Ledger - round 2026-07-19d (TODO.md: work COMPETITION.md)

Previous round 2026-07-19c closed and preserved in git history (f85d3b7).

User request: work COMPETITION.md. Section 4 is the plan; order is Wave 1
first (migration funnel + correctness): F1 PP import, F3 SPLIT type. F2
(PDF import) is L effort and deferred to its own round. F9 (custom
benchmarks, S) next if the session allows, then further Wave 2/3 items.

## Constraints (from TODO.md + CLAUDE.md, apply to every task)
- [ ] One subworker at a time, ledger updated before each delegation
- [ ] Commit per task, short meaningful message, no branches
- [ ] Every feature behind a feature_flags row (seeded enabled), en+de+es
- [ ] schema.sql + idempotent migration when the data model changes
- [ ] No em-dashes, du/tu register, no badges, sortable tables + row hover,
      skeletons not placeholders
- [ ] Lint + tsc + tests + production build green before each commit

## Task F1 - Portfolio Performance CSV import (closes G2, High)

Design (orchestrator): new `BrokerFormat` "portfolioperformance" in
lib/import/csv.ts, exactly parallel to the existing `fintrack` round-trip
format. PP is open source; the subworker verifies the real CSV export
column layout from the PP GitHub source before writing the parser (never
guess columns). German and English header variants, semicolon-delimited,
deNum for German decimals. Type mapping: Kauf/Buy -> BUY, Verkauf/Sell ->
SELL, Einlieferung/Delivery (Inbound) -> BOOKING; dividend/interest/account
rows and Auslieferung are skipped + counted (no matching TransactionType /
no identifier). Reconcile/fingerprint/merge reused unchanged. Kill-switch
flag `importPp` (migration + schema.sql, seeded enabled), checked in
import-transactions.tsx after detection. Inline anonymized fixtures in
tests/import.test.ts; detection must not clash with the six existing
signatures.

- [x] F1a. Verify PP CSV export layout from PP source (subworker research;
      orchestrator independently re-verified the exporter path and cell
      formatting against the actual GitHub source — the subworker's cited
      `CSVExporter.java` path was one level shallow (it lives under a
      `csv/exporter/` subdirectory, not directly in `csv/`), but the header
      order, delimiter-by-locale, and no-price-column findings all check
      out. Additionally confirmed: PP writes via Apache Commons CSV
      `CSVPrinter` (`QuoteMode.MINIMAL`, quote char `"`), and `Values.Amount`
      formats with grouping ("#,##0.00" / `%,.2f`) — so a real English-locale
      export with an amount >= 1000 emits a quoted field like
      `"1,234.56"`. `splitLine`'s existing quote-tracking handles this
      correctly already; the risk was never the parser, only test coverage.)
- [x] F1b. Parser + detection + flag + tests + i18n keys (subworker)
- [x] F1c. Lint + tsc + tests + build green (subworker; 60 files / 699 passed)
- [x] F1c-2. Orchestrator review found the English-locale test fixture's
      comment claims to exercise a real thousands-separator value
      ("1,200.50") but the actual fixture string is "-1200.50" with no
      separator at all — so the quoted-comma path (the one real-world case
      that would break naive unquoted splitting) was never actually tested.
      Subworker fixed: PP_EN Sell row's Value is now the genuine quoted cell
      `"-1,200.50"` (matching Commons CSV's QuoteMode.MINIMAL output),
      comments corrected. Orchestrator independently re-ran lint, tsc,
      vitest (60 files/699 passed/4 skipped) and the production build — all
      green.
- [x] F1d. Commit (below)

## Task F3 - SPLIT transaction type (closes G6, High-side Medium)

Design (orchestrator, verified by reading every replay site): new
`TransactionType` member `"SPLIT"`. Semantics: `quantity` holds the ratio
(new shares per old share — 2 for a 2-for-1 split, 0.5 for a 1-for-2 reverse
split); `price`/`fee`/`tax` are always 0. No feature flag (COMPETITION.md:
correctness fix, ship directly, unlike F1's kill switch).

Replay sites requiring an explicit SPLIT branch (shares *= ratio, avgCost /=
ratio, inserted BEFORE any catch-all `else`):
- `lib/finance/portfolio.ts` `computePosition` (new branch) and `sharesAt`
  (currently unsorted/additive-only — must sort by date first, since a split
  is order-dependent: only shares acquired before it are multiplied).
- `lib/finance/trades.ts` `realizedByMonth` and `lib/finance/tax.ts`
  `taxYearBreakdown`: **both have a bug risk** — their replay loop is
  `if (BUY||BOOKING||INTEREST) {...} else {/* treated as SELL */}`. Without
  an explicit SPLIT branch inserted before that `else`, a SPLIT row falls
  into the SELL arm and fabricates a bogus realized gain / taxable event.
  Confirmed by reading both functions; this is the one part of the task
  that will silently corrupt the tax report if missed.
No change needed (verified): `irr.ts` `positionIRR`, `returns.ts`
`netFlows` (both already default non-BUY/SELL to 0 cash flow), `portfolio.ts`
`anchorTx`/`holdingPeriodProfit`'s flow loop/`cashAssetInPortfolio` (none
match SPLIT into a wrong arm).

Other required changes:
- `lib/types.ts`: add `"SPLIT"` to `TransactionType`, extend the doc comment.
- `lib/import/csv.ts`: add `"SPLIT"` to `VALID_TX_TYPES`; `isValidTx`'s
  `tx.price > 0` check must become `tx.type === "SPLIT" || tx.price > 0`
  (else the fintrack-round-trip re-import silently drops every SPLIT row).
- `supabase/schema.sql` + new migration `0072_split_transaction_type.sql`:
  widen `transactions_type_check` to include 'SPLIT' in BOTH the create-table
  inline check and the existing idempotent drop/recreate upgrade block
  (mirror the exact pattern already there for the 0055 tax-column widen).
- `components/assets/transaction-form.tsx`: 4th segmented-toggle option
  SPLIT (non-cash only); hides price/fee/tax fields, quantity field relabels
  to a ratio input with a hint, total-preview box replaced with a neutral
  ratio readout, submit forces price/fee/tax to 0 and skips price validation.
- `components/assets/asset-detail.tsx`: `txTypeLabel` SPLIT case; table row
  type color (new, distinct from BUY/SELL/BOOKING/INTEREST); quantity cell
  prefixes "×" for SPLIT rows (a bare "2" in the qty column would read as 2
  shares, not a 2:1 ratio); price/total cells show "—" for SPLIT (no market
  price, no cash flow); edit-row type SelectMenu gets a SPLIT option
  (non-cash only).
- `components/charts/performance-chart.tsx`: add `"SPLIT"` to
  `ChartMarker["type"]`, fill `MARKER_COLOR`/`MARKER_GLYPH` (compiler forces
  this via the `Record<ChartMarker["type"],...>` sites); asset-detail's
  marker legend gets a SPLIT entry.
- `components/assets/import-transactions.tsx`: `txTypeColor` SPLIT case.
- i18n en/de/es: `tx.split`, `tx.splitRatio`, `tx.splitHint`, `tx.addSplit`,
  plus whatever the total-preview readout key ends up being.
- Tests: `computePosition`/`sharesAt` with an out-of-order BUY→SPLIT→SELL
  sequence; `realizedByMonth` and `taxYearBreakdown` each with a
  BUY→SPLIT→SELL sequence asserting the SPLIT itself produces NO realized
  gain / taxable bucket entry (the regression test for the bug above);
  `isValidTx` accepts a SPLIT row with price 0.

- [x] F3a. Orchestrator design (above)
- [x] F3b. Implementation via subworker (all files listed above touched;
      6 new tests: computePosition ×2, sharesAt out-of-order regression,
      realizedByMonth, taxYearBreakdown, isValidTx)
- [x] F3c. Orchestrator independently re-read every diff before running
      anything: confirmed the SPLIT branch sits BEFORE the final `else` in
      both trades.ts:55 and tax.ts:216 (the critical bug-risk spot), the
      sharesAt sort-before-replay fix, the schema.sql + migration 0072
      widen both the inline and idempotent-upgrade check, and the
      transaction-form/asset-detail/performance-chart UI changes all match
      the design. Independently ran lint (clean), tsc --noEmit (clean),
      vitest (60 files/705 passed/4 skipped, up from 699), the dictionaries
      key-parity test (3 passed) and production build (green) myself.
- [x] F3d. Commit (below)

## Deferred this round
- [~] F2 PDF import (L effort, own round)

## Task F9 - custom benchmarks (closes G10)

Design (orchestrator, read the full existing benchmark machinery before
writing this): the curated `BENCHMARKS` array (`lib/finance/benchmarks.ts`,
5 entries) stays as-is (kept as suggestions, per COMPETITION.md). Custom
benchmarks are additive, ephemeral (component `useState`, same as the
existing `benchmarks: string[]` selection already is in every call site —
no persistence layer needed, keeps this bounded).

Data flow: curated benchmarks are DB-cached (shared `benchmark_history`
table via `/api/benchmarks`) — writing arbitrary user-picked ISINs into that
shared cache would be unbounded pollution, so custom picks must NOT go
through that route. Instead reuse `/api/history` (POST `{base, range,
items: HistItem[]}` → `{histories: Record<key, points>, fx}`, response keyed
by `item.key` exactly — verified in app/api/history/route.ts:303/310/320),
the same per-user cached (`instrument_history`) path asset detail charts
already use. Range: fixed "5Y" (not tied to the chart's own timeframe —
curated benchmarks are also timeframe-independent, they fetch a flat window
once and `PerformanceChart` clips to the visible range).

Resolution: reuse `resolveInstrumentByQuery` (`lib/import/resolve-instrument.ts`,
catalog → `/api/lookup`, already shared by add-asset/watchlist/savings-plan —
never build a fourth copy of this). A resolved `ResolvedMaster` becomes a
`Benchmark`: `id = assetPriceKey(resolved)` (dedup key), `item = { key: id,
source: "yahoo", id: "", currency: resolved.currency || "EUR" }` (mirrors
the two ISIN-keyed curated entries), `label = resolved.name`, `color` from a
small rotating palette distinct from the 5 curated hex values already used
(#3b82f6/#a855f7/#eab308/#ef4444/#14b8a6).

Files:
- `lib/finance/benchmarks.ts`: add a pure, unit-testable
  `buildCustomBenchmark(master: ResolvedMaster, existing: Benchmark[]):
  Benchmark | null` (null = already present in curated OR existing custom,
  dedup by id) and a `customBenchmarkColor(index: number): string` palette
  picker. Business logic here, not inline in a component, so it's testable
  without React.
- `components/charts/use-benchmark-compare.ts`: new optional 3rd param
  `custom: Benchmark[] = []`. Curated ids keep the existing `/api/benchmarks`
  fetch untouched. Custom ids (in `custom` AND in `selected`) get a second
  effect POSTing to `/api/history`, merged into a separate `Record<base,
  Record<key, points>>` cache. Final `CompareSeries[]` concatenates both
  sources, still ordered/filtered by `selected`.
- `components/charts/benchmark-picker.tsx`: existing curated pills unchanged
  behavior; add an inline add-custom control (text input, resolve on
  Enter/blur via `resolveInstrumentByQuery` + `buildCustomBenchmark`, loading
  + not-found states) and render resolved custom entries as pills with a
  small remove ("×") affordance in addition to the toggle. New props for the
  custom list + add/remove callbacks — parent owns the state.
- Three call sites each get `const [custom, setCustom] = useState<Benchmark[]>([])`
  passed to both `BenchmarkPicker` and `useBenchmarkCompare`:
  `components/dashboard/net-worth-hero.tsx`, `components/assets/asset-detail.tsx`,
  `components/shared/shared-portfolio-view.tsx` (the read-only share view —
  adding a client-side-only comparison overlay there is harmless, doesn't
  touch the shared data). Do NOT touch `components/analysis/risk-view.tsx` or
  `components/llm/use-portfolio-chat.ts` — both call `useBenchmarkCompare`
  with a fixed methodological benchmark (MSCI World for beta/alpha), not a
  user-facing picker; the new 3rd param must default to `[]` so these two
  call sites need zero changes.
- i18n en/de/es: add-custom placeholder, not-found error, remove-button
  label/aria.
- Tests: `buildCustomBenchmark` — dedup against curated id, dedup against an
  existing custom id, builds a correct `Benchmark` from a `ResolvedMaster`;
  `customBenchmarkColor` — cycles without colliding with the 5 curated hex
  values.

- [x] F9a. Orchestrator design (above)
- [x] F9b. Implementation via subworker. Caught and corrected a real flaw in
      the orchestrator's own spec: dedup must compare against each existing
      benchmark's `item.key` (the real price key), not `.id` — curated
      entries' `.id` is an arbitrary slug ("msci-world"), so comparing
      against `.id` would never have caught a genuine duplicate pick.
      Subworker also browser-verified end-to-end in Guest Mode (add by ISIN,
      toggle, not-found error, duplicate-add error, remove) beyond what was
      asked. New tests/benchmarks.test.ts, 11 cases.
- [x] F9c. Orchestrator independently re-read every diff (benchmarks.ts,
      use-benchmark-compare.ts, benchmark-picker.tsx, all three call sites,
      i18n, tests) before running anything; confirmed the dedup-by-item.key
      correction, the /api/history vs /api/benchmarks data-path split, and
      that risk-view.tsx/use-portfolio-chat.ts needed no changes. Ran lint
      (clean), tsc --noEmit (clean, after clearing a stale unrelated
      `.next/dev/types` cache artifact), vitest (61 files/713 passed/4
      skipped, up from 705), dictionaries-es parity (3 passed), and
      production build (green) myself.
- [x] F9d. Commit (below)
