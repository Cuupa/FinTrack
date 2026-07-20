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
- [ ] F9 custom benchmarks (S) if session allows
