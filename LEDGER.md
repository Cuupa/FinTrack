# Ledger - round 2026-07-20c (COMPETITION.md Wave 3)

Wave 3 = F7 (interest-bearing cash), F8 (OTHER manual-valuation asset), F9
(custom benchmarks), F10 (persisted rebalancing). **F9 already shipped**
(c60ee97). Remaining: F7, F8, F10. Working one at a time, commit each.

## Constraints (unchanged): no em-dash, du/tu register, NO badges, sortable
tables + row hover, skeletons not placeholders, commit per task, no branches,
lint+tsc+test+build green before each commit. Every feature: en+de+es, flag
row, schema.sql + migration both idempotent.

## F7 - Interest-bearing cash (closes G8). Effort M.

Design (orchestrator): a CASH asset carries an annual interest rate +
compounding frequency; interest accrues and is booked as INTEREST
transactions (type already exists, bc712f7, zero-cost-basis, counts as
return) after an explicit review step, mirroring savings plans.

- Data: 2 optional nullable fields on `Asset` (per-holding, on `assets` row).
  `interestRate?: number|null` (annual %, e.g. 3.5), `interestFrequency?:
  InterestFrequency|null` (MONTHLY|QUARTERLY|ANNUAL, new union in types.ts).
  `AssetInput = Omit<Asset,"id">` so LocalStore/OfflineStore/queue thread it
  automatically; only SupabaseStore + schema need explicit work.
- Finance core: `lib/finance/cash-interest.ts` (pure). `dueInterest(asset,
  txs, today, max=60)` -> `{date, amount}[]`: period boundaries at first-tx
  anchor + k periods, resuming after the last booked INTEREST tx; per payout
  the amount = runningCashBalance * rate/100 / periodsPerYear, compounding
  through previously-proposed rows in the batch. Balance = signed sum of the
  asset's txs (BUY/BOOKING/INTEREST +, SELL -) as of the payout date.
- UI: config + review-and-book live on the CASH asset detail page (one new
  component, `CashInterestSection`) - canonical editor supports later rate
  changes; books INTEREST txs at price 1 into the asset's existing portfolio.
  Flag-gated `cashInterest` (seeded disabled).
- i18n en/de/es. Vitest over the pure function. schema.sql + migration 0077.

- [x] F7a. types.ts: InterestFrequency + Asset fields (optional, so existing
      literals stay valid; AssetInput auto-threads through Local/Offline).
- [x] F7b. lib/finance/cash-interest.ts + 12 tests (compounding, resume after
      last booked, mid-period deposit, quarterly, day clamp, cap). Note: a
      pre-existing tests/cash-interest.test.ts covers the INTEREST tx TYPE
      (bc712f7) - accrual tests live in tests/cash-interest-accrual.test.ts.
- [x] F7c. SupabaseStore mapping (AssetRow, select, addAsset, updateAsset now
      builds a partial update object for notes + both interest fields).
- [x] F7d. schema.sql + migration 0077 (assets cols + cashInterest flag seed
      disabled) + FeatureFlag union.
- [x] F7e. CashInterestSection (self-contained; config + review-and-book) on
      asset detail, gated held+CASH+flag; i18n en/de/es (cashInterest.*).
- [x] F7f. lint+tsc clean, vitest 764 pass, build green. Verified Guest Mode
      DE + EN: seeded 10k Tagesgeld dated 2026-01-15, 3.6% monthly -> 6
      compounding credits (30.00/30.09/30.18/30.27/30.36/30.45), booked ->
      balance 10,181.35, "Erhaltene Zinsen" 181.35, due bar clears, next
      credit date shown, all 6 INTEREST rows in the tx log. No badges,
      du/tu register correct.

## F8 - OTHER manual-valuation asset (closes G9). Effort M. (pending)
## F10 - Persisted rebalancing targets (closes G11). Effort M. (pending)
