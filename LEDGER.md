# Ledger - round 2026-07-20 (TODO.md: COMPETITION.md Wave 2)

Previous rounds (Wave 1: F1 PP import 3b907f7, F3 SPLIT 2b6aca7, F9 custom
benchmarks c60ee97, F3b auto split-detection 7ac0504) closed and preserved
in git history + below.

User request (TODO.md): implement COMPETITION.md **Wave 2** (Wave 1 already
shipped), and check Wave 1 for loopholes.

Wave 2 = F4 (announced dividend calendar), F5 (web push notifications),
F6 (Vorabpauschale estimator).

## Constraints (from TODO.md + CLAUDE.md, apply to every task)
- [ ] One subworker at a time, ledger updated before each delegation
- [ ] Commit per task, short meaningful message, no branches
- [ ] Every feature behind a feature_flags row (seeded enabled), en+de+es
- [ ] schema.sql + idempotent migration when the data model changes
- [ ] No em-dashes, du/tu register, no badges (the existing EstimatedBadge
      honesty-label is the sanctioned exception, already used across the app),
      sortable tables + row hover, skeletons not placeholders
- [ ] Lint + tsc + tests + production build green before each commit

## Wave 1 loophole check (done first)
- [x] Verified SPLIT (F3) is handled at EVERY share-counting replay site:
      `sharesAt` (sorts + `*= ratio`), `computePosition` (explicit SPLIT
      branch), and all chart series (`netWorthSeries`, `assetPriceSeries`,
      `twrSeries`, `holdingPeriodProfit`) route through those two. Cash-flow
      loops (`irr.positionIRR`, `returns.netFlows`, `holdingPeriodProfit`
      flow loop) correctly treat SPLIT as zero flow. `cashAssetInPortfolio`
      is CASH-only where SPLIT can't occur. No loopholes; no fix needed.

## Task F6 - Vorabpauschale estimator (closes G7, Medium)

Design (orchestrator - mathematical core, implemented directly not delegated):

German Vorabpauschale per fund per year (InvStG 2018+):
  Basisertrag  = startValue x Basiszins x 0.7   (0 when Basiszins <= 0)
  Vorab_fund   = max(0, min(Basisertrag - Ausschuettungen, Wertsteigerung))
  Wertsteigerung (value-gain cap) = max(0, endValue - startValue)
Year total = sum over ETF funds; RAW (pre-Teilfreistellung - TF is applied
downstream by taxYearBreakdown exactly as for the manual entry, so the
estimate feeds the SAME `settings.vorabpauschale[year]` slot).

Reference data (Basiszins per year) is DB-seeded, world-readable, owner-
written (no-hardcoded-reference-data rule; COMPETITION.md: "app_config-style
table, owner-seeded"). New table `basiszins` (year int PK, rate numeric as a
decimal fraction, note text). Seed the published BMF values 2018-2025
(2021/2022 negative -> no Vorabpauschale). Read client-side via
`useBasiszins()` (direct browser-supabase world-readable read, same shape as
`useBillingConfig`); guests on prod read the anon-visible table, local dev
without keys -> empty map -> no estimate (graceful, same precedent as catalog).

Only COMPLETED years (< current year) are estimated: Vorabpauschale accrues
at year-end and is deemed inflow on Jan 2 of the following year, so the
current incomplete year has no assessable figure yet (also sidesteps needing
a year-end price for the ongoing year).

Simplifications (documented in code, like the rest of tax.ts):
- position taken at year start (`sharesAt(txs, Y-01-01)`); mid-year 1/12
  monthly proration ignored (a fund bought mid-year has 0 shares at Jan 1 ->
  excluded, conservative). Value-gain cap uses year-start shares x year-end
  price (ignores mid-year share changes for the cap).
- funds without a usable real history series are skipped (under- not
  over-estimate).

Pure function `estimateVorabpauschaleByYear` in lib/finance/tax.ts
(unit-tested): takes assets, txs, histories (HistoryMap), fxHistory,
spotFx+base, dividend events, basiszinsByYear, currentYear. Uses `priceAtFrom`
(pure, lib/history/history.ts) + an inlined carry-forward FX lookup
(rateAtCarryForward is deliberately duplicated, not imported - CLAUDE.md) +
`sharesAt`/`dividendsFromEvents` (finance core). Returns Record<year, rawVorab>
for years with a positive total only.

Integration (components/analysis/tax-view.tsx, no store change - estimate is
derived, not persisted):
- new `useHistory(fundItems, "10y", currency)` for ETF funds only.
- `useBasiszins()` + `useFeatureFlag("vorabEstimate")` (flag gates the
  estimate only; the manual entry is untouched).
- `vorabForCalc = { ...estimated, ...manual }` (manual wins, broker
  statements authoritative) -> passed as settings.vorabpauschale.
- vorab EditableAmountRow gets an `estimate` prop: when the user has no manual
  entry, the estimated raw amount shows (muted + existing EstimatedBadge) and
  already feeds the waterfall; editing still seeds empty. Estimated-only years
  now surface a tax card (correct - you owe the tax with no sale).

Flag `vorabEstimate` (migration 0074 + schema.sql, seeded enabled) alongside
the `basiszins` table + seed. i18n en/de/es (du/tu): estimate label/tip,
"estimated" hint. Tests: fundVorabpauschale math (positive basiszins, negative
-> 0, cap binds in a down year, distributions reduce), estimateByYear
(excludes current year, excludes funds with no start position, sums funds,
skips missing history).

- [x] F6a. Orchestrator design (above)
- [x] F6b. Implemented: basiszins table + vorabEstimate flag (migration 0074 +
      schema.sql + seed 2018-2025, and backfilled the schema_migrations list
      0071-0074 which had drifted), fundVorabpauschale +
      estimateVorabpauschaleByYear in tax.ts, useBasiszins hook, tax-view
      wiring (useHistory for funds + merged vorabForCalc + estimate on the
      EditableAmountRow), vorabTip reworded en/de/es, tests/vorabpauschale.test.ts
      (11 cases). vorabEstimate added to the FeatureFlag union.
- [x] F6c. Verified: tsc clean, lint clean, vitest 63 files/735 passed/4
      skipped (up from 724), production build green. Browser-verified the tax
      tab renders without crash in EN + DE (Guest Mode, injected ETF BUY+SELL
      -> 2023-2026 year cards all render, vorab row shows the graceful "—"
      since the basiszins table needs Supabase; no console errors). The
      estimate positive-path (estimated value + EstimatedBadge feeding the
      waterfall) activates on prod once migration 0074 seeds basiszins - math
      is unit-tested.
- [x] F6d. Commit (1852a20).

## Task F4 - announced dividend calendar (closes G4, Medium)

Design (orchestrator - live-verified Yahoo before building, per F3b precedent):
the v8 chart endpoint the app uses is historical only (confirmed: KO range=10y
max date is before server-now). Confirmed UPCOMING ex/pay dates live in Yahoo's
quoteSummary `calendarEvents`, which is crumb-locked (v10 + v7 return
Unauthorized without one). Verified the keyless crumb handshake works both via
curl AND in Node undici (getSetCookie -> getcrumb -> quoteSummary): KO returns
ex 2026-09-15, pay 2026-10-01. Fails soft everywhere (any error -> null -> the
trailing projection stays), so the crumb fragility is acceptable - the app
degrades to exactly today's behaviour if Yahoo changes the handshake.

Files:
- lib/server/yahoo.ts: crumb infra (getCrumb 30min cache + 401-refresh,
  quoteSummaryJSON sharing getJSON's limiter/breaker) + dividendCalendar +
  announcedByQuery(query, hint, fallbackQuery) - hint authoritative, never
  scans past it (same phantom-attribution rule as dividends/splits).
- app/api/dividends/calendar/route.ts: POST {items} -> {announced: Record<key,
  {exDate,payDate}>}, mirrors /api/dividends minus FX.
- lib/history/use-announced-dividends.ts: gated by `enabled` (dividendCalendar
  flag) so a disabled flag spends zero crumb calls.
- lib/finance/dividends.ts: pure `applyAnnouncedDate(projected, payDate, today)`
  - re-dates the earliest projected payment to the confirmed date + flags it,
  rest unchanged; past/absent date leaves projection untouched.
- dividends-view.tsx: folds announced dates into the forecast, confirmed rows
  show a green "confirmed" text (no badge), disclaimer updated.
- flag `dividendCalendar` (migration 0075 + schema.sql + FeatureFlag union).
- i18n en/de/es (div.confirmedDate + disclaimer addition).
- tests: applyAnnouncedDate (5, tests/dividend-forecast.test.ts) +
  announcedByQuery (4 in yahoo-throttle.test.ts: hint authoritative + no
  search, dead hint no search, no-hint search, 401 crumb-refresh retry).

- [x] F4a. Orchestrator design + live Yahoo/undici crumb verification (above).
- [x] F4b. Implemented all files above (done directly - fragile crumb infra).
- [x] F4c. Verified: tsc clean, lint clean, vitest 64 files/744 passed/4
      skipped (up from 735), es-parity, build green (/api/dividends/calendar
      present). Browser-verified end to end EN + DE (Guest Mode, injected KO):
      /api/dividends/calendar returns KO ex 2026-09-15 pay 2026-10-01, and the
      /dividends forecast shows "Coca-Cola Oct 1, 2026 confirmed" (green)
      replacing the earliest projection with later dates staying projected,
      disclaimer updated. No console errors.
- [ ] F4d. Commit.

## Remaining this round
- [ ] F5 web push notifications
