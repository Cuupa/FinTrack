# Ledger — round 2026-07-18d (closed 2026-07-18)

Previous round 2026-07-18c closed and preserved in git history (0d1eb3f).

## Price staleness false alarm (user report: Tesla stale even after refresh-all)
- [x] 1. Root cause confirmed: cron wrote `price_synced_at` only when the price CHANGED (`changed()` guard), so weekends froze every equity's timestamp at Friday and /admin/prices misread healthy rows as stale/dead
- [x] 2. Fixed: `last_price` + `price_synced_at` now written on every SUCCESSFUL resolve in all cron paths (yahoo equity, onvista refresh, coingecko crypto; onvista fallback was already unconditional); `changed()` deleted as unused (244c1c8)
- [x] 3. `updated` counters now mean "rows successfully synced"
- [x] 4. Failure paths verified untouched: no write on failure, so a frozen timestamp stays the honest signal for truly unresolvable rows (Robeco LU2145461757 mutual fund: Yahoo found:false verified on prod AND local, onvista fallback failing too - stays Dead by design until a listing is seeded manually or a source exists)
- [x] 5. All `price_synced_at` readers audited (catalog, /api/price, admin overview/prices, isPriceFresh prefill) - all treat it as last-successful-sync, none regress; 585 tests + lint green
- [~] 6. Runtime verification deferred to prod: cron needs Supabase (local dev is guest-only). OWNER ACTION: deploy, then Revalidate all - Tesla must turn fresh despite the weekend
- [~] 7. Possible follow-up (not requested): /admin/prices could distinguish "unresolvable - no source" from ordinary staleness so rows like the Robeco fund stop masquerading as sync failures
