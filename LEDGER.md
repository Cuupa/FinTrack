# Ledger — TODO.md work session (2026-07-16, Fable orchestrator)

Claimed by: this session. One subworker at a time. Commit per task, no branches.

## P1 — Bugs
- [x] GME: price shows 2,63 € again — FIXED + verified (local /api/price?q=GME&currency=EUR → 19.52 €, history path → GameStop series; 432 tests green). ROOT CAUSE: /api/price?q=GME&currency=EUR returns 2.63 = Geratherm Medical AG (GME.F, Frankfurt), the only EUR listing among Yahoo's "GME" candidates. The currency filter runs BEFORE the exact-ticker tier in resolveSymbol/resolveQuote/historyByQuery (lib/server/yahoo.ts), so the real GameStop (GME, USD, exact match) is eliminated first. Fix: exact-ticker tier takes precedence over the currency filter; currency preference applies within the tier; callers already FX-convert. Delegated to Sonnet.
- [x] Multiselect dropdowns: entries not editable on mobile — root cause: portfolio picker's rename/delete were hover-revealed (opacity-0 group-hover), no hover on touch. Fixed via pointer-fine variants + larger touch targets; verified Pixel-7 emulation (visible + rename works) and desktop (hover-reveal intact). Commit f191fb2. Bonus: scope/portfolio summaries localized.
- [x] Dropdowns: scan done (7 native selects: tx form type+portfolio, settings currency, 4 admin filters) — all replaced with themed SelectMenu; verified dark-mode rendering in-browser. Commit 678f1e6.

## P2 — Small features
- [x] Dark mode: persist theme per user in DB; no setting ⇒ follow system default — already shipped in 3cee7b1 (profiles.theme via store seam, ThemeSync, null = system via prefers-color-scheme); verified in code, nothing to do
- [x] Spanish: es locale added (type, LOCALES, INTL_TAG es-ES, browser guess, LocaleSync), full 850-key dictionary in tú register, parity test (keys + placeholders vs en), verified in-browser (lang=es, dashboard/settings render Spanish). Commit 02b0591. Legal pages deliberately stay EN+DE.
- [x] Import: new transactions grouped per asset with tri-state group checkbox (all/partial/none); verified e2e with a 2-asset/4-tx CSV (group uncheck excludes its transactions, footer count correct). Commit d5fd14e.

## P3 — Larger features
- [x] LLM integration: PLAN delivered → LLM_INTEGRATION.md (BYO key localStorage-only, /api/llm streaming proxy to keep CSP tight, provider seam, llmChat flag seeded disabled, datenschutz update, phased P1-P3, 3 open questions for owner). Implementation deliberately not started (TODO asked for a plan).
- [x] Monte Carlo: savings plans included (active plans → monthly equivalent, FX-aware, default-on checkbox; pure helper + tests). Commit 642a79a.
- [x] Monte Carlo: layout restructured into Ansparphase / Entnahmephase / Modell sections; rebalance checkbox moved into the model section; guidelines box → InfoTip; model-note pill chip removed (no-badge rule); chart shows dashed line at withdrawal start; panel fully localized en/de/es. Verified in-browser (DE dark + agent-verified EN with seeded plan). Commit 642a79a.
- [x] Savings plans: recurring cash deposits: CASH positions plan-eligible at price 1 (a6f418b) + one-click cash position from the plan form (ff311aa).
- [x] Savings plans: VL are BOOKINGS, not buys (owner correction #3): plans carry a Buchungsart (Kauf | Einbuchung); Einbuchung books free external inflows at zero cost basis (migration 0061). Verified e2e: 3×40 € booked as Einbuchung, +120 € gain. Commit 9fb9d6c.
- [x] Settings: per-portfolio fee model (flat order fee, waive-above volume, savings-plan fee; portfolios ARE the brokers via their user-given name — NO hardcoded broker presets per owner correction). Prefills tx form + savings-plan bookings, manual edit wins. Full store seam + migration 0058. Verified e2e (200 € → 1 €, 1000 € → 0 € with waive-from 500). Commit ea897a8.
- [x] Settings: redesigned to responsive two-column grid, danger zone full-width. Verified in-browser DE. Commit ea897a8.
- [x] Onboarding: guided tours on risk / rebalancing / simulation (TourOverlay generalized, profile.toursDone, migration 0060, ghost ? replay buttons); verified in-browser (auto-start once, replay works, DE+EN). Commit 09804d2.
- [x] Onboarding: asset-detail tags tour (what tags are, how to add, Analysis Custom payoff, local-only storage note). Commit 09804d2.
- [x] Taxes: editable fields (Vorabpauschale, withheld override) locked behind pen icon, ✓ apply / ✕ discard, Enter/Escape; verified in-browser. Commit 71f0e44.
- [x] Taxes: Freistellungsauftrag per broker (= per portfolio, migration 0059; per-broker allowance shields its own gains, leftover only offsets pooled dividends/Vorabpauschale; per-broker breakdown in tax view; field in fees card). Commit 71f0e44.
- [x] Fees card (owner correction #2): one broker selected via dropdown, only its fee fields shown. Commit 71f0e44.

## Round 2026-07-17 (Fable orchestrator, this session)
### T1 Dropdowns
- [x] Searchable SelectMenu matches ISIN/WKN (and symbol) via hidden per-option `keywords` (verified diff: filter matches label OR keywords, rendering label-only; 480 tests + lint green)
- [x] ISIN/WKN not displayed in the option entries (render path untouched)
- [x] Applied at the savings-plan asset picker; grep confirmed no other searchable asset SelectMenu exists
### T2 Savings plan editable
- [x] Plans editable (asset, portfolio, amount, interval, booking type, start date) via shared PlanForm + updateSavingsPlan; edit never touches active/lastRunDate; key={editing.id} remount fix after review (480 tests + lint green)
- [x] Delete keeps ConfirmDialog; presence-gating pattern preserved
- [x] Bonus: paused-state pill removed (no-badge rule) — plain subtitle text + dimmed name
### T3 Settings tabs
- [ ] Settings panels behind tabs (not badges): Tab "General" = name/currency + language + guided tour + change password + danger zone; Tab "Fees & taxes" = broker fees + taxes
- [ ] Localized en/de/es, du/tú registers, es parity test stays green
### T4 Tags in the store (user override of the earlier localStorage-only decision)
- [ ] Tag groups + assignments persist through the DataStore seam (LocalStore + SupabaseStore + OfflineStore mirror/queue + sync replay)
- [ ] Idempotent migration + schema.sql update; RLS per user
- [ ] Existing localStorage tags migrate into the store once, losslessly
- [ ] /datenschutz claims updated (tags no longer local-only for registered users); CLAUDE.md updated
### T5 Monte Carlo
- [ ] Layout decluttered; accumulation vs withdrawal phases clearly distinguished
- [ ] Rebalancing option explained in context (what/where to)
- [ ] "Eingezahlt" line stops hard at withdrawal start (no decline after contributions end)
- [ ] Chart/bands must not hard-stop when a percentile hits 0
- [ ] X-axis ticks at sensible regular intervals (no 15y guess-gaps)

## Implicit expectations & constraints
- [ ] No badges of any kind (hard rule)
- [ ] No em-dashes in user-facing copy; German copy uses du-register only
- [ ] Every table sortable + row hover highlight
- [ ] Skeleton loading instead of placeholders (e.g. prices)
- [ ] Desktop emulation at 1920x1080
- [ ] Data model changes: update supabase/schema.sql AND a migration, idempotent
- [ ] Feature gating via DB feature flags (never env vars)
- [ ] Verify in-app (both locales where copy changes); probe prod before rediagnosing "still broken" reports
- [ ] Each task committed separately with a short meaningful message
- [x] Clean starting tree (orphaned staged badge remnants unstaged; working tree == HEAD)
