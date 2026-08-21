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
- [x] Light+Dark visual pass DONE (Playwright + cached chromium, 1920x1080, guest mode). Primary Button verified by COMPUTED style in both themes: light = #18181b fill / white text, dark = #f4f4f5 fill / #18181b text; secondary = outline, tertiary = text. Action hierarchy correct (one dark CTA per card, brand no longer the fill). Screenshots: settings + dashboard, both themes. NOTE: the first attempt showed transparent primaries — a STALE Turbopack build on the prior session's dev server (predated the Phase 1 CSS, never generated `bg-action-primary`). A clean `.next` rebuild fixed it; not a code bug.
- [ ] Categorical PALETTE visual-on-chart check deferred: pure constant is unit-tested (no #059669/#ef4444); a data-bearing chart review folds into Phase 5 /analysis polish rather than seeding now.

### DONE — Phase 2 Display/format fixes (2026-08-21)
- [x] **K9 Verbindlichkeiten Zeitraum**: replaced the stock-exchange strip (1W..MAX, which only trimmed the tiny past and left the 24-year forecast untouched) with a debt horizon `Gesamt / 5 Jahre / 10 Jahre` (`components/debt/debt-view.tsx`). Real windowing: the horizon caps the FORECAST (`plan.series` + minimum-payments `baseline`) at today+N months; the measured past is always shown in full. New dict keys `debt.chart.horizon.all/5y/10y` (en/de/es). Removed now-unused `TIMEFRAMES`/`Timeframe`/`timeframeStart` imports.
- [x] **Simulation Y-axis**: `axisCurrencyFormatter` gained an opt-in `{ perTick }` (components/charts/axis.ts) — each tick picks its own k/M magnitude instead of one shared unit. Fixes the LOG-scale defect where decade ticks (10k, 100k) both collapsed to "0M". Used only by `distribution-chart.tsx`; every other chart keeps the shared-unit default. Unit-tested (`tests/axis.test.ts`).
- [x] **Simulation result terms**: `sim.contributed` -> "Eingezahltes Kapital", `sim.growth` -> "Wertzuwachs im Median", new `sim.medianWealth` = "Projiziertes Endvermögen im Median" for the final-wealth Stat (the three now read as an equation). `sim.median` kept for the WITHDRAWAL stat (annual income) where "Endvermögen" would be wrong. en/de/es.
- [x] **Rebalancing**: `-0,0 %` normalized via `normalizeZero` on both the per-position diff and the target-sum readout; a real zero shows unsigned. Added an `InfoTip` (`rebalance.total.hint`, en/de/es) next to a target sum that deviates from 100%, explaining Normalise. 
- [ ] DEFERRED to Phase 5 (layout polish, needs browser iteration): rebalancing asset-name truncation when space allows, and a shared percent baseline/axis for Ist vs Ziel bars.
- [ ] DEFERRED: data-bearing visual confirm of the debt horizon window + simulation labels folds into Phase 6 visual QA (needs a seeded liability + a MC run). Smoke: /debt + /simulation load with 0 console errors, no raw key leaks; tsc + 1320 tests + eslint green.

### DONE — Phase 3 Settings security flows (2026-08-21) — owner chose "do it, verify on prod"
- [x] **Password change re-authentication**: `AuthProvider` gained `reauthenticate(password)` (re-signs in the SAME user, verifies the current password, refreshes the session, never switches accounts). `settings-view.savePassword` now requires and verifies the current password before `updatePassword` — but ONLY when `hasPassword` (OAuth-only accounts are setting a first password, nothing to verify). New "Aktuelles Passwort" field + `settings.currentPassword` / `settings.currentPasswordWrong` (en/de/es). Save gated on the current-password field too.
- [x] **Account deletion consequence dialog**: the danger-zone delete (already gated by typed "delete" + password) now routes through `ConfirmDialog` spelling out the concrete consequences (account + every portfolio/account/transaction/setting + removal from shared households, irreversible). New `settings.deleteAccountConfirm` (en/de/es). Satisfies CLAUDE.md "every destructive action gets a ConfirmDialog" + Audit 5.6.
- [x] **Dirty-state save gating (Audit 5.6)**: Profil and Steuern Save buttons disable until a field actually changes (`profileDirty` / `taxDirty` derived from `data.profile`). Verified in guest mode (Playwright): disabled -> enabled on edit -> disabled again on revert.
- [x] **Page description covers all tabs**: `settings.subtitle` broadened from "Profil/Sprache/Sicherheit" to profile/household/taxes/AI (en/de/es).
- [x] Settings container already `max-w-3xl` (768px) — inside the audit's 720-800px, no change.
- [x] tsc + eslint clean; 1320 tests pass; /settings loads with 0 console errors.
- [x] **Household + AI flows (owner: "do them")**: HouseholdView was already strong — leave/remove both route through `ConfirmDialog` with consequence copy ("loses access to shared accounts"), seat cap counts pending invites, invitations list + revoke, `limitHint` names the cap+price. The ONE gap was the paid seat: `addSeat` fired on a single click (a recurring charge). Now gated behind a `ConfirmDialog` stating the monthly cost (`household.addSeatConfirm` / `addSeatConfirmCta`, en/de/es). AI section already correct: `handleProviderChange` resets the model to the provider default and the model dropdown is provider-scoped (provider<->model dependency), and the connection test POSTs only `{ ping, provider, model, key }` — no portfolio context (minimal-data). No change needed there.
- [ ] TO VERIFY ON PROD (registered-only, not locally exercisable): current-password reauth rejects a wrong password; delete dialog end to end; paid-seat confirm on the demo. No migration needed (pure client/auth logic).
- NOTE: broker/provider switch does not silently discard — the fee row and AI config are seeded once and a switch reinitializes intentionally; tab switch preserves state (single component). Not treated as a defect.

### DONE — Phase 4 Progressive disclosure / form unification (2026-08-21)
Audit §5.4: forms are actions, not permanent primary content. Reused the existing `Modal` + `EmptyState` + `FormActions` primitives — no new components.
- [x] **Budget** (`components/spending/budgets-card.tsx`): the permanent add form moved into a `Modal`. `progress.length === 0` now shows an `EmptyState` (title `spending.budgets.emptyTitle`, hint = benefit, one CTA `spending.budgets.emptyCta` "Erstes Budget anlegen") that opens it; when budgets exist a secondary "Budget hinzufügen" in the header opens the same modal. Closes on successful save. Add trigger hidden when every category is already budgeted (`canAdd`). No-categories branch unchanged.
- [x] **Goals** (`components/goals/goals-view.tsx`): removed the always-visible add Card. `GoalForm` (already reused by the edit modal) now also backs a new add `Modal`, opened by a "Ziel hinzufügen" button in the list-card header (and by the `EmptyState` CTA when empty). `data-tour="goals-form"` moved onto the button so the tour still points at the add affordance. Same form for create + edit (owner rule). New `goals.form.emptyHint`.
- [x] **Pension** (`components/pension/pension-view.tsx`): the two remaining permanent forms — Renteninformation letters (`StatementsFields`) and year-by-year points (`PointsCard`) — moved into `Modal`s opened by a per-section "hinzufügen" button; list/result first, form closes on save. Empty states `pension.statements.empty` / `pension.points.empty`. Contracts were already modal-based (no change). The `overMax` amber hint + `looksLikeStatements` notice + rate-subtraction line all preserved. `pension-points` tour target wraps the whole card, so no tour breakage. No finance calc touched.
- [x] All keys in en/de/es (parity green). tsc + eslint clean; 1320 tests pass. Guest-mode Playwright smoke: goals + both pension modals open, 0 console errors; budgets card mounts clean (no-categories state, guest has none).
- [ ] DEFERRED to Phase 6: data-bearing confirm of the budget "has categories, no budgets" modal path (needs a seeded spending category) and the pension modals with real rows.

### Blockers — RESOLVED by owner (2026-08-21)
- K5 Teilfreistellung: owner said "vorerst nicht anfassen" -> SKIPPED this pass. Global checkbox + calc unchanged. Do not touch.
- K6 Zielzählung: owner wanted "the cleanest technical variant". VERIFIED in code: no double-count exists. `goalTotals` derives a composite parent from its children (parent's own amount ignored while it has children); the page summary (`goals-view.tsx:585`) reduces over TOP-LEVEL rows only, sub-goals nested under parents. Count/target/progress are already clean -> no code change (inventing one would alter correct logic). Left untouched.

### Rule
No commits until each vertical slice is complete + verified. No mixed commits.
