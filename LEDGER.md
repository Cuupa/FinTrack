# LEDGER — ROADMAP items #9-#10

Continuing the sequence from items #5-#8 (see git history). Each item fully
shipped (data model + store seam + finance module + UI + i18n en/de/es +
tests + build/lint green) and committed before moving to the next.

## Item #9: Debt payoff (flag `debtPayoff`)
- [x] Migration 0088 + schema.sql: `accounts` gains nullable `interest_rate`
      (annual %) + `min_payment` columns, flag seeded disabled
- [x] `lib/types.ts`: `Account.interestRate`/`minPayment` (optional, nullable)
- [x] `lib/finance/dates.ts`: `addMonthsToDate` helper
- [x] `lib/finance/debt.ts` (pure): `amortizationSchedule` (single debt),
      `planPayoff` (avalanche/snowball multi-debt simulator with extra
      payment)
- [x] Store seam: supabase-store.ts row mapping only (Local/Offline/sync are
      generic passthrough, no changes needed)
- [x] UI: `/debt` route, sidebar nav entry (desktop only)
- [x] i18n en/de/es (`nav.debt` + `debt.*` block, es parity test green)
- [x] Unit tests: 19 cases in tests/debt.test.ts (amortization + avalanche/
      snowball + addMonthsToDate)
- [x] Verify: build + lint + unit tests green (891 passing), browser smoke
      test in Guest Mode EN+DE (liability account -> rate/payment dialog ->
      schedule + payoff plan + strategy switch + extra-payment savings
      sentence, zero console errors)

## Item #10: Insurance register + coverage prompts (flag `insurance`)
- [x] Migration 0089 + schema.sql: `contracts` gains nullable
      `insurance_type` + `sum_insured` columns, flag seeded disabled
- [x] `lib/types.ts`: `InsuranceType`, `Contract.insuranceType`/`sumInsured`
      (optional, nullable)
- [x] `lib/finance/insurance.ts` (pure): `coverageGaps` over core DACH
      insurance types
- [x] Store seam: supabase-store.ts row mapping only
- [x] UI: extended `/contracts` (contracts-view.tsx) with insurance
      type/sum-insured form fields + a coverage-gap prompt card, both gated
      on the `insurance` flag; list rows show the insurance type + sum
      insured as plain subtext (no badges)
- [x] i18n en/de/es
- [x] Unit tests: 5 cases in tests/insurance.test.ts
- [x] Verify: build + lint + unit tests green, browser smoke test in Guest
      Mode (added a "Personal liability" contract, coverage-gaps card
      dropped it from the list, zero console errors)

## Notes
- No new tables for either item — both extend an existing entity
  (accounts / contracts), matching the roadmap's framing ("liability
  accounts gain amortisation", "typed rows on the contract entity from #5").
- New Account/Contract fields are optional (`?:`) so existing call sites
  (accounts-view.tsx, contracts-view.tsx submit/acceptCandidate) don't need
  edits to keep compiling.
- `/datenschutz` not touched: both items add fields to already-disclosed
  entities (accounts, contracts), not a new data category or provider.
- AI context (`lib/llm/context.ts`) not extended, matching the precedent set
  by items #5-#8 (none of them extended it either, despite the roadmap's
  "as each item ships" cross-cutting note).
- Found and fixed a real amortization bug during unit testing: the last
  month's principal was capped against the original balance parameter
  instead of the current remaining balance, causing a small overpayment.
- Exported `accountFxRate` from `lib/finance/accounts.ts` (was a private
  `rateFor`) so the debt view can convert `minPayment` to the base currency
  the same way the account balance itself already is.
