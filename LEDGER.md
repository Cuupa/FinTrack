# Ledger - round 2026-07-19c (TODO.md: prices prio 1, monetization, error log)

Previous round 2026-07-19b closed and preserved in git history (e7519d5).

User request: work TODO.md. Three tasks, prices marked prio 1, so order is
prices -> monetization (incl. gratitude premium) -> error log rework.

## Task 1 - prices won't update (prio 1)

Diagnosis (orchestrator, verified against prod):
- All five ISINs (LU0256331488, LU2145461757, LU0048578792, JE00B2NFTS64,
  IE00BMVB5N38) resolve and quote fine on onvista, and prod's own
  /api/price?q=<isin> returns correct prices via the onvista fallback.
- The prices cron leaves exactly the 13 hint-less rows (no quote_source/
  quote_id learned yet) unpriced while all 49 hinted rows synced today.
- Root cause: app/api/cron/sync/prices/route.ts has no `maxDuration` export
  while every deliberately long cron sibling (sync, benchmarks,
  etf-breakdowns, billing) exports 300. The bulk sync self-calls sub-syncs
  over HTTP, so each runs as its own function with the default short cap:
  hinted rows update fast, hint-less rows wait on the Yahoo semaphore for a
  full search and the function is killed before the onvista fallback runs.
  No new data provider needed - the onvista pool member already covers all
  five instruments.

- [x] 1a. `export const maxDuration = 300` on all cron sub-sync routes missing it (prices, retention, constituents, classifications, shared-portfolios, names, error-logs)
- [x] 1b. Lint + tsc + tests green (633 passed/4 skipped), production build passes with all 11 cron routes emitted
- [x] 1c. CLAUDE.md cron note: every /api/cron/* route must export maxDuration (HTTP self-call = own duration budget)
- [x] 1d. Commit (ddace95)
- [~] 1e. Prod verification (rows price after next deploy + cron run) - needs owner push/deploy, deferred to owner like prior rounds' prod checks

## Task 2 - monetization

Design (orchestrator): `plan_grants` table (migration 0068 + schema.sql,
select-own RLS, service-role writes), `resolvePlan(sub, now, grants?)` treats
an active pro grant (expires_at null = infinite, or future) as an independent
path to "pro"; BillingProvider loads own grants; settings card shows a
"granted" state without checkout/portal buttons (no Stripe customer); admin
grant/revoke on /admin/billing via /api/admin/billing/grants (email search
through the existing /api/admin/users, audited, revoke behind ConfirmDialog,
sortable hover-highlighted table, no badges, en/de/es).

- [x] 2a. Gratitude premium schema: plan_grants w/ end date or infinite (0068 + schema.sql, idempotent)
- [x] 2b. resolvePlan honors grants (pure; tests extended: billing-plan 8 cases, subscription-view 7 cases, billing-admin parseGrantBody 11 cases)
- [x] 2c. Admin UI to grant/revoke on /admin/billing + grants API (audited; table sortable + row hover; ConfirmDialog on revoke; skeletons; en/de/es du/tu)
- [x] 2d. Settings subscription card shows granted state, hides checkout/portal buttons
- [x] 2e. Lint + tsc + tests (660 passed/4 skipped) + build green; CLAUDE.md billing paragraph updated
- [ ] 2f. Commit
- [ ] 2g. Remaining MONETIZATION.md phases 3/4 (assess what is implementable without owner risk gates)

## Task 3 - error log rework (levels not types)

- [ ] 3a. Understand current error log implementation
- [ ] 3b. Rework to severity levels (debug/info/warn/error/fatal) instead of error types
- [ ] 3c. Tests + lint + build green
- [ ] 3d. Commit

## Cross-cutting
- [ ] C1. One subworker at a time, ledger updated per task
- [ ] C2. Commit per task, no branches, short meaningful messages
- [ ] C3. No em-dashes, du-register, no badges in any UI work
