# LEDGER — ROADMAP item #1: Accounts & liabilities entity (flag `accounts`)

Keystone entity: net worth learns to go negative + gains balance-accounts
(checking/savings/credit/loan/mortgage/other) distinct from derived-from-trades
holdings. Full store seam + pure finance module + `feature_flags` row, seeded
disabled, dark-launched, en+de+es.

## Tasks
- [x] 1. Domain types: `Account`, `AccountBalance`, `AccountKind`, added to `PortfolioData` + `emptyPortfolio`
- [x] 2. Migration 0080 + schema.sql: `accounts` + `account_balances` tables, RLS, FK cascade, `accounts` flag seeded disabled, idempotent
- [x] 3. `DataStore` seam: `addAccount/updateAccount/deleteAccount/setAccountBalances` (types.ts)
- [x] 4. LocalStore: read-backfill + CRUD + replace-set balances
- [x] 5. SupabaseStore: load fetch + CRUD
- [x] 6. OfflineStore: mirror + queue for all four
- [x] 7. mutation-queue MutationOp union + sync.ts applyOp cases
- [x] 8. `lib/finance/accounts.ts` (pure): carry-forward `accountValueOn`, signed `accountsValueOn`
- [x] 9. Fold accounts (signed by is_liability) into `netWorthSeries` (optional params)
- [x] 10. PortfolioProvider: expose `accounts`/`accountBalances` data + mutations
- [x] 11. `accounts` added to `FeatureFlag` type
- [x] 12. UI: `/accounts` page (flag-gated) + accounts view + add form + balances dialog (ConfirmDialog on delete)
- [x] 13. Sidebar + mobile-nav link (flag-gated)
- [x] 14. Dashboard net-worth hero folds accounts into net-worth KPI + chart
- [x] 15. AI context: accounts summary (id-free)
- [x] 16. /datenschutz: manual account balances note (EN+DE)
- [x] 17. i18n en/de/es keys
- [x] 18. Unit tests: `tests/accounts.test.ts` (signed fold + carry-forward)
- [x] 19. Verify: build + lint + unit tests green; guest round-trip in-app

## Notes
- Balance stored as user-entered magnitude in native currency; net contribution
  = `(isLiability ? -1 : 1) * balance`. Overdrawn checking = user enters negative.
- `opening_balance` @ `opened_on` = implicit first balance point; carry-forward.
  Before `opened_on` an account contributes 0 to net worth.
- Accounts are NOT tied to a portfolio (user-global) — no portfolio cascade.
- Accounts fold is data-driven (empty arrays contribute 0), so the finance core
  need not know about the flag.
