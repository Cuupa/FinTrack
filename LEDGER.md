# LEDGER — ROADMAP items #5-#8

(Item #3 bank-statement import shipped and committed in 082cc6b; task 4 in its
old ledger entry was actually done, just left unchecked. Superseded below.)

Working four items in sequence, each fully shipped (data model + store seam +
finance module + UI + i18n en/de/es + tests + build/lint green) and committed
before moving to the next.

## Item #5: Recurring detection + contract register (flag `contracts`)
- [x] Migration 0084 + schema.sql: `contracts` table, RLS, flag seeded disabled
- [x] `lib/types.ts`: `Contract`, `ContractInterval`, `CONTRACT_INTERVALS`,
      `PortfolioData.contracts`
- [x] Store seam: types.ts (`ContractInput` + CRUD), LocalStore, SupabaseStore,
      OfflineStore, `lib/offline/sync.ts`, PortfolioProvider
- [x] `lib/finance/recurring.ts` (pure): `detectRecurringCandidates` — clusters
      spending transactions by payee+amount, classifies period, skips rows
      already linked via `recurringId`
- [x] UI: `/contracts` route, sidebar + mobile nav entry, `FeatureFlag` union
- [x] i18n en/de/es
- [x] Unit tests: recurring detection
- [x] Verify: build + lint + unit tests green

## Item #6: Named savings goals (flag `goals`)
- [x] Migration 0085 + schema.sql: `goals` table, RLS, flag seeded disabled
- [x] `lib/types.ts`: `Goal`, `PortfolioData.goals`
- [x] Store seam (all layers)
- [x] `lib/finance/goals.ts` (pure): progress + required monthly contribution
- [x] UI: `/goals` route, nav entry
- [x] i18n en/de/es
- [x] Unit tests
- [x] Verify: build + lint + unit tests green

## Item #7: Financial-health gauges (flag `finHealth`)
- [x] No new tables — derives from accounts/spending/budgets already in tree
- [x] `lib/finance/health.ts` (pure): months-of-expenses, savings rate,
      debt-to-income, net-worth-to-income
- [x] Feature flag `finHealth` seeded disabled (feature_flags row via migration
      0086 + schema.sql)
- [x] UI: `/health` route (read-only 4-tile gauge dashboard, no CRUD), nav entry
- [x] i18n en/de/es
- [x] Unit tests
- [x] Verify: build + lint + unit tests green, browser smoke test (empty +
      populated gauge states, zero console errors)

## Item #8: Retirement / FIRE planner (flag `firePlanner`)
- [x] No new tables — reframes existing monte-carlo.ts + stats.ts (migration
      0087 + schema.sql seeds only the flag row)
- [x] `lib/finance/fire.ts` (pure): `fireNumber`/`leanFireNumber`/
      `fatFireNumber`, `yearsToFire` (deterministic compounding, capped at
      100y), `trailingAnnualExpenses`, `computeFirePlan`
- [x] Feature flag `firePlanner` seeded disabled
- [x] UI: `/fire` route (lean/regular/fat tiles + live withdrawal-rate and
      manual-override inputs, worker-run Monte Carlo section reusing
      DistributionChart + the loadSimulation/saveSimulation cache seam),
      sidebar entry (desktop only, mobile nav intentionally untouched)
- [x] i18n en/de/es (`nav.fire` + `fire.*` block, es parity test green)
- [x] Unit tests: 17 cases in tests/fire.test.ts
- [x] Verify: build + lint + unit tests green (872 passing, +17 from
      baseline 855), browser smoke test in Guest Mode EN+DE (live
      withdrawal-rate recompute, manual override inputs, Monte Carlo run
      completing in under a second with correct probability-fan chart and
      success-probability stat, zero console errors)

## Notes
- Following the accounts/spending/budgets pattern exactly: full DataStore
  seam (Local/Supabase/Offline + sync.ts replay), flag-gated route with
  `FeatureUnavailable`/skeleton/`LoadError`, sortable table with hover
  highlight (CLAUDE.md rule), no badges (CLAUDE.md rule).
- Committing after each item lands, short precise messages.
