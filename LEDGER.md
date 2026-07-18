# Ledger — round 2026-07-18d (open)

Previous round 2026-07-18c closed and preserved in git history (0d1eb3f).

## Price staleness false alarm (user report: Tesla stale even after refresh-all)
- [ ] 1. Root cause (diagnosed): prices cron writes `price_synced_at` only when the price CHANGED (`changed()` guard), so the column means "last price change" while /admin/prices reads it as "last successful sync"; on weekends every equity freezes at Friday's close and drifts stale/dead
- [ ] 2. Fix: bump `last_price` + `price_synced_at` on every SUCCESSFUL resolve, price changed or not, in all cron paths (yahoo equity, onvista refresh, onvista fallback already unconditional, coingecko crypto)
- [ ] 3. `updated` response counter = successfully synced rows (semantics follow the write)
- [ ] 4. Constraint: failure paths keep NOT touching `price_synced_at` (a frozen timestamp stays the honest signal for truly unresolvable rows, e.g. the Robeco LU fund - Yahoo found:false, verified prod+local; that row stays dead by design until a source exists)
- [ ] 5. Verify: vitest + lint green; cron not runnable locally (no Supabase) - prod verification after user deploys: refresh-all must turn Tesla fresh on a weekend
