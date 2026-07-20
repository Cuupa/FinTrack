# Ledger - round 2026-07-20b (TODO.md: three fixes)

Previous round (Wave 2: F6 1852a20, F4 4d9bb2f, F5 b22c918, docs e8e702a)
closed in git history + preserved below.

User request (TODO.md): three tasks.
1. Savings plan: display the plan type in the table.
2. Asset: show percentage return of an asset for the selected timespan.
3. Risk: Alpha and Beta are not calculated.

## Constraints (unchanged): no em-dash, du/tu, no badges, sortable tables +
row hover, skeletons not placeholders, commit per task, no branches,
lint+tsc+test+build green before each commit.

## Task 3 (done first) - Risk alpha/beta not calculated

Diagnosis (orchestrator, probed PROD per the probe-prod-before-rediagnosing
rule): `/api/benchmarks?ids=msci-world&base=EUR` returned 0 points on prod
while the other 4 benchmarks had ~500 each. Beta/alpha go null when the MSCI
World benchmark has < 3 points (`benchLevels` in risk-view.tsx), so the whole
risk page showed "not calculated". Root cause = empty `benchmark_history` for
msci-world only.
- Immediate fix: forced a refetch (`&force=1`) -> msci-world now has 505 EUR
  points on prod, so beta/alpha compute again (verify on prod).
- Code hardening (prevents recurrence): `readSeries` in app/api/benchmarks/
  route.ts returned empty when the requested base had no rows but the
  benchmark was cached in a NON-base currency (the base==EUR fallback branch
  was a no-op, and the staleness gate `latestDate` checks any currency so it
  wouldn't refetch). Generalize the fallback to convert from ANY cached
  currency (EUR first, then the other persisted ones) so a benchmark cached
  only in a non-base currency still returns a converted series.

- [x] 3a. readSeries any-currency fallback (app/api/benchmarks/route.ts).
      Verified on PROD (demo login): risk page now shows Beta 1,25 / Alpha
      -7,9% instead of "not calculated", after the force-refetch repopulated
      msci-world (505 EUR points). Code fix ships for future robustness.

## Task 2 - Asset timeframe return

Show the contribution-adjusted return over the selected chart timeframe on
the asset detail page, next to the chart (updates with the timeframe, unlike
the lifetime KPI tiles). Held assets use `holdingPeriodProfit(asset, txs, tf,
chartValuation, histories).pct` (same methodology as the dashboard hero's
windowChange); non-held instruments (no txs) fall back to the price series'
first-to-last % change. Skeleton while history loads. i18n en/de/es key
`asset.periodReturn`.

- [x] 2a. timeframeReturn memo + readout under the chart + i18n
      (asset.periodReturn). Verified in Guest Mode EN+DE: "+19.84% return
      (1Y)" / "Rendite (1Y)", updates with the timeframe, skeleton while
      loading.

## Task 1 - Savings plan type in the list

The dashboard savings-plans list shows amount + interval + next date but not
the bookingType (BUY vs BOOKING / Einbuchung). Add it to the descriptor line,
reusing the existing `tx.buy`/`tx.booking` labels (no new UI, no badge).

- [x] 1a. bookingType added to the plans list line (tx.buy/tx.booking).
      Verified Guest Mode EN+DE: "monthly · Booking" / "monatlich ·
      Einbuchung".

## Round close-out
Three tasks done + verified (2 in Guest Mode, risk on prod). Lint/tsc/vitest
(752 passed)/build green. Commits below.
