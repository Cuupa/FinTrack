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
- [x] 2f. Commit (dd66a6c)
- [ ] 2g. Remaining MONETIZATION.md phases 3/4, dark-launched (billing flag off in prod, all flags still seeded free, so no visible change until owner flips at runtime):
  - [ ] 2g-1. ProTeaser component + useFeature adoption on /analysis tabs, /dividends, /simulation, /xray, /rebalancing
  - [ ] 2g-2. /pricing page + owner-editable display prices in billing_config + legal updates (datenschutz Stripe processor, terms subscription section, EN+DE du)
  - [ ] 2g-3. Phase 4: plan_limits resolution + enforcement at add-surfaces (grandfathering: existing over-cap rows stay usable) + plan_limits editor card
  Owner-gated and NOT part of this round: flipping required_plan tiers, enabling billing, first live checkout, price-point decision (MONETIZATION.md section 7).

## Task 3 - error log rework (levels not types)

Design (orchestrator): severity becomes the primary classification.
`error_logs.level` text ('debug'|'info'|'warn'|'error'|'fatal', migration
0069 + schema.sql, default/backfill 'error'), `reportError` and /api/errors
carry a validated `level` (default 'error'), capture surfaces map
global-error -> fatal, route boundary/window/unhandledrejection -> error.
`kind` stays as a display column (capture source), but the admin filter
switches from kind to level; level renders as color-coded plain text (no
badges), table sortable + row hover per user rules.

- [x] 3a. Understand current error log implementation (kind-based: report.ts, /api/errors, /admin/errors, 0051)
- [x] 3b. Rework to severity levels (debug/info/warn/error/fatal) instead of error types: migration 0069 + schema.sql (level column + check constraint + index, default/backfill 'error'); ErrorLevel type + reportError level default/dedupe-key in lib/errors/report.ts; global-error.tsx -> fatal, error.tsx + error-reporter.tsx (window/unhandledrejection) -> error explicit; /api/errors validates level allowlist (absent -> error, invalid -> 400); /admin/errors: level replaces kind as the filter + SelectMenu, level own sortable column (color-coded plain text, no badges: debug gray/info blue/warn amber/error red/fatal red+semibold), kind kept as plain sortable column, every column sortable (Th/sort-state idiom from admin/prices), row hover, skeleton loading kept; en/de/es dictionary keys added (kindAll removed, now unused)
- [x] 3c. Tests + lint + build green: extended tests/error-report.test.ts (level default/explicit/dedupe-by-level), new tests/errors-route.test.ts (POST /api/errors level defaulting + full allowlist + invalid level 400, kind 400 still works) - lint clean, tsc clean, 58 test files / 672 passed / 4 skipped, production build green (25 routes incl. /admin/errors)
- [x] 3e. Follow-up (coordinator): fixed a migration-0069-lag regression - a prod DB that hasn't applied 0069 has no `level` column, so the insert would fail and the route's existing never-a-500 posture silently 204'd, dropping every report until the owner migrates (worse than pre-0069 behavior, violating the migration-0065 "lagging DB behaves as before" convention in CLAUDE.md). app/api/errors/route.ts now retries the insert once without the `level` field on any insert error, still 204 either way. Added 3 tests to tests/errors-route.test.ts (fallback succeeds after first-insert failure w/ payload assertions on both calls; still 204 if fallback also fails; no retry when first insert succeeds) - lint clean, tsc clean, 58 test files / 675 passed / 4 skipped, build green
- [ ] 3d. Commit (not done - task instructed not to commit; owner/orchestrator to commit)

## Cross-cutting
- [ ] C1. One subworker at a time, ledger updated per task
- [ ] C2. Commit per task, no branches, short meaningful messages
- [ ] C3. No em-dashes, du-register, no badges in any UI work
