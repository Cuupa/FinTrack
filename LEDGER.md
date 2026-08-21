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

### DONE — Phase 5 Page polish (2026-08-21)
Audit §5.5 deferred layout items. No new dictionary keys, no finance calc touched.
- [x] **Rebalancing percent axis / shared baseline** (`components/rebalancing/rebalancing-view.tsx` `DeviationBars`): the Ist/Ziel bars now scale to a rounded axis max (`niceAxis`, ticks on clean 0/25/50/75/100%-style percentages) instead of the bare `maxPct`, with faint vertical gridlines behind every bar and a percent-axis label row aligned to the same track. Both bars already shared one baseline; the axis makes the magnitude legible. Verified in guest mode (2 seeded OTHER holdings): axis + gridlines render, 8000/9200≈87% and 1200/9200≈13% bars correct, 0 console errors.
- [x] **Rebalancing name truncation** (same file): the position-name column widened responsively (`w-44 lg:w-56 xl:w-64`) and carries a `title` tooltip, so names truncate only when they genuinely overflow and the full name is always reachable.
- [x] **Übersicht dual-scale annotation**: NO CHANGE warranted. The status strip (`net-worth-hero.tsx`) already states liquid/invested/debt as absolute figures above the chart, and `NetWorthBreakdownChart` already carries three labeled lines (net/assets/liabilities), a zero baseline, a legend and a per-date tooltip with all three magnitudes — exactly the "detail values/annotations" §5.5 asks for, without the forbidden artificial dual axis. Documented, left untouched.
- [x] tsc + eslint clean on the touched view.

### Blockers — RESOLVED by owner (2026-08-21)
- K5 Teilfreistellung: owner said "vorerst nicht anfassen" -> SKIPPED this pass. Global checkbox + calc unchanged. Do not touch.
- K6 Zielzählung: owner wanted "the cleanest technical variant". VERIFIED in code: no double-count exists. `goalTotals` derives a composite parent from its children (parent's own amount ignored while it has children); the page summary (`goals-view.tsx:585`) reduces over TOP-LEVEL rows only, sub-goals nested under parents. Count/target/progress are already clean -> no code change (inventing one would alter correct logic). Left untouched.

### DONE — Phase 6 start: e2e specs realigned to the redesigned UI (2026-08-21)
Owner rule (absolute, 2026-08-21): nothing is "done" while a single test is red. The full e2e suite had 14 reds — all from UI I changed in earlier phases without pulling the specs along. Root causes + fixes (specs only, no product code):
- **debt.spec.ts:55** — Phase 2 replaced the debt-chart timeframe strip (1W..MAX) with a `Total/5y/10y` horizon; the test still clicked "MAX". Now clicks "Total" (shows the full measured past, so 2019 still visible).
- **simulation.spec.ts:9** — Phase 2 renamed the final-wealth tile from `sim.median` ("Median outcome") to `sim.medianWealth` ("Projected final wealth (median)"); "Median outcome" now only appears in the withdrawal card. Test waits for "Projected final wealth".
- **goals.spec.ts:40/89/122/153 + interest-goals.spec.ts:44** — Phase 4 moved the add-goal form into a `Modal`; specs filled `#goal-*` on a form that no longer sits in the page. Each now opens the modal via `[data-tour="goals-form"]` first, scopes fields + submit to the dialog (trigger and submit share the "Add goal" label), and waits for it to close. The "Part of" reopen uses two Escapes (the SelectMenu popover does not stop Escape, so one closes the whole modal).
- **pension.spec.ts:61/74/84/98/114/127/163** — Phase 4 moved the Renteninformation + year forms into `Modal`s; `addYear`/`addStatement` helpers now open the section's button first, scope to the dialog, submit, and assert close.
- RESULT: full e2e **77 passed / 0 failed**; unit **1320 passed / 0 failed**. Committed separately (specs + this ledger only).

### DONE — Phase 6 Responsive/a11y/Visual-Regression QA sweep (2026-08-21)
Representative visual sweep of the redesigned surfaces via a throwaway Playwright screenshot script (guest mode on :3011, en-US, seeded 2 accounts + 1 loan + 1 OTHER asset through the real UI). Captured at desktop 1440x900, tablet 768x1024, mobile 390x844, plus a dark-mode pass (prefers-color-scheme: dark) on overview/accounts/analysis/settings. Scripts live in scratchpad only — no product/test code changed.
- Desktop (overview, portfolio, accounts, spending, cashflow, goals, debt, rebalancing, analysis, retirement FIRE+pension, simulation, settings): all clean and consistent. Phase 5 rebalancing percent axis legible; Phase 4 goals/pension/budget triggers render as buttons (forms behind modals); analysis tab + sub-tab strips and donut correct; settings unified card width with the Phase 3 dirty-state Save correctly disabled.
- Mobile: KPI heros reflow to 2-col, bottom nav present; multi-column tables (goals) scroll inside their own card — the app-wide `overflow-x:auto` pattern, page body does not scroll horizontally. Cramped but not a regression.
- Dark mode: consistent palette, readable muted empty states ("Add holdings...", "No data"), correct disabled-button contrast. No token gaps found.
- RESULT: **no P0/P1 visual regressions**. One P2 note (mobile wide-table density) is the existing app pattern; no change made without owner direction. Unit **1320/0** green; e2e unchanged from the last green run (**77/0** at 8dcea97) since this pass touched no code.
- Not covered by the seed (deferred, lower value): debt payoff chart (needs a rate+min-payment on the loan) and a post-run simulation tile — both already pinned by their e2e specs.

### DONE — Phase 7 Stale-style/component cleanup (2026-08-21)
Authoritative dead-export scan (ts-prune -p tsconfig, framework route exports filtered out). Removed only genuinely orphaned code left by the redesign; no behaviour change.
- `components/ui/primitives.tsx`: removed a **duplicate** `SummaryStrip` (props `items: SummaryItem[]`) shadowed by the live `components/ui/summary-strip.tsx` (`metrics: SummaryMetric[]`) that every consumer (accounts-hero, debt-view) actually imports — a two-`SummaryStrip` footgun. Took its now-dead `SummaryItem` type + `SUMMARY_COLS` const with it. Also removed the unused `Section` primitive (spec §7.3, adopted by no page) and the unused `SECTION_STACK` constant (`PAGE_STACK` stays, widely used). `Stat` stays (used everywhere).
- `lib/share/share.ts`: removed `decodeShare`, superseded by `decodeShareAny` (the `/shared` fragment page + Sankey generalization); `decodeShareAny` uses `decodeFragment`+`normalizeShare` directly, never `decodeShare`.
- Deleted `lib/ui/use-collapsed.ts` (whole file, `lib/ui/` now gone): orphaned by commit 8d33c7a "recurring card no longer collapsible" — its last and only consumer.
- Verified NOT stale (left untouched): the remaining `#ef4444`/`#059669` are all legit semantic uses (SELL markers, liabilities line, shortfall, over-budget, brand icon) — Phase 1 only dropped them from the categorical PALETTE. `TIMEFRAMES`/`timeframeStart` still used widely; Phase 2 only pulled them from debt-view. No stale feature flags: the redesign was IA-preserving and removed no feature.
- RESULT: tsc + eslint clean; unit **1320/0**; e2e **77/0**. Committed (primitives + share + deleted hook + this ledger only; the pre-existing uncommitted FINTRACK_UX_UNIFICATION_SPEC.md left out).

### DONE — Phase 8 Styleguide skill regeneration (2026-08-21) — FINAL phase
Regenerated `.claude/skills/styleguide/SKILL.md` from the final cleaned code. Every value cite-checked against source (`app/globals.css`, `primitives.tsx`, `summary-strip.tsx`, `format.ts` `plColor`, `colors.ts` `PALETTE`, `table.tsx`, `form-actions.tsx`, `notification-count.tsx`, `theme-context.tsx`). The prior skill predated the redesign and was materially wrong; corrected:
- **Color model rewritten around the semantic tokens** (Spec §5): surfaces (`bg-app/-surface/-surface-hover`), borders (`border-subtle/-strong`), text (`text-primary/-secondary/-tertiary`), `brand` (teal-green `#087f63`→`#2ad1a3`, for nav/tabs/focus/selection, NOT the CTA), `action-primary` (near-black/near-white CTA fill), `positive/negative/warning/info`, and a **6-color** neutral chart palette `chart-1..6` (the old skill said "zinc/emerald throughout" + "12-color palette"). Documented class-based `.dark` theming + `.incognito` privacy.
- **Buttons**: primary is now `bg-action-primary text-action-primary-fg` (was `bg-zinc-900 text-white`); noted the `destructive` alias.
- **plColor** now `text-positive/-negative/-tertiary` tokens (was `text-emerald-600`/`text-red-600`); noted `normalizeZero`.
- **Removed the `SECTION_STACK` citation** (deleted in Phase 7); added the live `SummaryStrip` (summary-strip.tsx) to the primitive catalog; added `NotificationCount`, `ProMenuItem`, geometry radii (`rounded-surface`/`rounded-control`).
- **Honesty note kept**: the token migration is not total — tables, inputs, `Modal`/`ConfirmDialog`, `FormActions` border, the focus ring + `NotificationCount` ring still use raw `zinc`/`emerald`; skill flags exactly those and says new surfaces prefer tokens.
- Docs-only change (no product/test code): unit **1320/0** green; e2e unchanged from the Phase 7 green run (**77/0**) since nothing the browser exercises was touched.
- STABILIZATION PASS COMPLETE: P0 (API-key hardening, Freistellungsauftrag validator) + Phases 1-8 all done. Owner-deferred K5 Teilfreistellung untouched. Prod-only checks still open (see Phase 3): current-password reauth rejects wrong pw, delete-account dialog end-to-end, paid-seat confirm on demo, apply migration 0132_llm_key_last4.sql + verify the account-scope key path.

### Rule
No commits until each vertical slice is complete + verified. No mixed commits.
NEW absolute rule (owner, 2026-08-21): a phase is NEVER "done" while any test is red. Run the FULL unit + e2e suite before reporting completion.
