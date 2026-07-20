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

- [ ] F3a. Orchestrator design of replay semantics (after F1)
- [ ] F3b. Implementation via subworker
- [ ] F3c. Verification + commit

## Deferred this round
- [~] F2 PDF import (L effort, own round)
- [ ] F9 custom benchmarks (S) if session allows
