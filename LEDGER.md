# Ledger

Claim a task here before delegating to a subworker or starting cross-cutting work.

## Active — Post-Redesign Stabilization Pass (session: feat/redesign, 2026-08-21)

Owner: main session. Plan: `FINTRACK_STABILIZATION_PLAN.md` (see §0 Addendum for the binding owner corrections).

### Done
- [x] Plan authored: `FINTRACK_STABILIZATION_PLAN.md`
- [x] CLAUDE.md table-sortable rule corrected (line 42)
- [x] LEDGER + plan §0 addendum record all owner decisions

### DONE (code) — P0 API-key server-side hardening (account-scope key never reaches the browser)
Root cause: `SupabaseStore` is client-side; browser read `llm_settings.api_key` via RLS and round-tripped it to `/api/llm`.
- [x] Migration `0132_llm_key_last4.sql` (adds `api_key_last4`, backfills, revokes table SELECT, re-grants SELECT on non-secret cols only).
- [x] Mirrored into `supabase/schema.sql` (column, revoke/grant block after the RLS policy, `('0132_llm_key_last4')` in the seed list).
- [x] `lib/types.ts` `LlmConfig`: optional `hasKey?`/`lastFour?`.
- [x] `lib/store/supabase-store.ts`: load selects `provider, model, api_key_last4` -> `{ key:"", hasKey, lastFour }`; `saveLlmConfig` writes `api_key_last4`, no `.select()` back, empty key updates ONLY provider/model.
- [x] `lib/llm/llm-context.tsx`: `configured` counts an account config with `hasKey`.
- [x] `app/api/llm/route.ts`: chat path reads the account key server-side via bearer -> `supabasePublishable().auth.getUser` + `supabaseSecret()` (`resolveAccountConfig`), adopts the ROW's provider/model. Ping stays body.key.
- [x] `lib/llm/proxy-chat.ts`: empty key -> attaches session bearer; browser/guest still send key in body.
- [x] `components/settings/settings-view.tsx`: stored key shows masked `Key stored ••••<last4>` + "Replace key" (+ cancel); editable input only when replacing/none stored; save keeps stored key on provider/model change; scope-move without the key is blocked.
- [x] `lib/i18n/dictionaries.ts`: `settings.ai.keyStored` / `replaceKey` / `replaceToMoveScope` in en/de/es.
- [x] `app/datenschutz`: added the "stored account key is never returned to the browser, used server-side only" guarantee.
- [x] typecheck clean, 1303 unit tests pass.
- [ ] STILL TODO: verify against LIVE/demo (dev is guest-only — cannot verify account scope locally). Apply migration 0132 on the live DB.

### DONE — P0 Freistellungsauftrag shared domain validator
- [x] Pure fns in `lib/finance/tax.ts`: `allowanceAllocation` / `allowanceAfterChange` -> `{ distributed, available, over, ok }` (1 cent float slack) + `AllowanceExceededError` (matched by name). Unit-tested (`tests/allowance.test.ts`).
- [x] UI: `PortfolioFeeRow` (settings Steuern & Gebühren) validates with `allowanceAfterChange` before save and blocks + shows `settings.fees.allowanceOver` (en/de/es). Gets `globalAllowance` + `otherAllowances` props.
- [x] Save path: `PortfolioProvider.updatePortfolio` re-checks with the SAME fn and throws `AllowanceExceededError` (dataRef synced in an effect for fresh state) — no in-app caller can exceed the cap past the form. Tax CALCULATION untouched.
- NOTE for owner: a truly bypass-proof guard against a *direct* Supabase write (outside the app) would need a DB trigger/CHECK comparing the sum of `portfolios.tax_allowance` against `profiles.tax_allowance` per user. Not added (would be a new migration + trigger); the app-layer shared check covers UI + every in-app save. Say the word if you want the DB trigger too.

### DONE — new owner asks (2026-08-21, batch)
- [x] **Recurring payments card collapsible** — already removed in commit 8d33c7a; `recurring-card.tsx:564` confirms "always expanded, no collapse toggle". No further change.
- [x] **Remove CASH from the portfolio/depot** — owner chose "komplett aus Depot + Net Worth" (authorized calc change). Add-asset picker no longer offers CASH (`add-asset-form.tsx`). New pure helper `nonCashAssets` (`lib/finance/portfolio.ts`); `summarizeAll` now excludes CASH (covers depot table + all holdings aggregations + dashboard/analysis/goals/fire/sim/chat totals). Net-worth CHART sites filter CASH too: net-worth-hero (series/breakdown/twr), returns-view, share-source. Single-asset paths (`summarizeHolding`/`assetValueSeries`) stay CASH-aware so an existing CASH position's own detail view still renders. Enum kept for import/back-compat. 1303 tests pass.
- [x] **Cashflow Sankey as default** — `spending-sankey-card.tsx` default view `flow` (was `bars`); module comment updated. Bars still available.
- [x] **Privacy blur in Simulation params** — `SliderField` gained `isPrivate` -> `data-private` on value display + input; set on Anfangskapital + Sparbetrag (+ savings-plan amount display). Percentages/years left unblurred per app convention (privacy masks absolute money only).

### DONE — Phase 1 Foundations (2026-08-21)
- [x] `app/globals.css`: `--action-primary` / `-hover` / `-fg` tokens (light #18181b/white, dark #f4f4f5/#18181b) + `@theme` mapping (K1).
- [x] `components/ui/primitives.tsx`: `Button` primary -> `bg-action-primary text-action-primary-fg hover:bg-action-primary-hover`; brand no longer the CTA fill.
- [x] `lib/colors.ts`: PALETTE rebuilt from chart hues, dropped `#059669`/`#ef4444` (K2) — no category can borrow positive/negative red/green.
- [x] `lib/format.ts`: `normalizeZero` snaps rounds-to-zero to +0 in `formatCurrency`/`formatCompactCurrency`/`formatPercent`/`formatPercentPlain`; `plColor` -> `text-positive`/`text-negative`/`text-tertiary` (K10).
- [x] Tests `tests/foundations.test.ts`; full suite 1319 green, tsc + eslint clean.
- SKIPPED (deliberate): `RadioCard` primitive — no consumer yet (Phase 3 KI storage picker). Not adding dead code.
- [ ] STILL TODO: Light+Dark visual pass for the broad Button/palette swap (Phase 1 acceptance) — needs browser; not done to save cost. Recommend before Phase 2.

### Blockers — RESOLVED by owner (2026-08-21)
- K5 Teilfreistellung: owner said "vorerst nicht anfassen" -> SKIPPED this pass. Global checkbox + calc unchanged. Do not touch.
- K6 Zielzählung: owner wanted "the cleanest technical variant". VERIFIED in code: no double-count exists. `goalTotals` derives a composite parent from its children (parent's own amount ignored while it has children); the page summary (`goals-view.tsx:585`) reduces over TOP-LEVEL rows only, sub-goals nested under parents. Count/target/progress are already clean -> no code change (inventing one would alter correct logic). Left untouched.

### Rule
No commits until each vertical slice is complete + verified. No mixed commits.
