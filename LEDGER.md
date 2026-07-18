# Ledger — round 2026-07-18a (closed 2026-07-18)

Previous round 2026-07-17e closed and preserved in git history (ea95e25).

## Prio 1: Uncommitted changes
- [x] 1. Working tree clean at round start (verified `git status --porcelain` empty); nothing to commit

## Asset page / Fees / Overview
- [x] 2. All shipped and verified last round: portfolio column (d9b5ff5), CASH savings-plan fee prefill (a2ba285), overview tour replay (59635f4)

## UI pass (recurring)
- [x] 3. Fresh user-POV walkthrough done (guest mode, 1920x1080, DE primary; seeded VWCE + Apple): dashboard, asset detail, analysis, dividends, xray, rebalancing, simulation, settings, login, impressum, datenschutz
- [x] 4. Constraints: no badges observed, tables sortable + hover, skeletons in use, du-register OK, no em-dashes

## Findings (this round)
- [x] 5. i18n: hardcoded English strings visible in DE locale (fixed 01f4843, browser-verified: Nettovermögen tooltip, Einklappen, Logarithmisch, Gesamt donut, keys in en+de+es, 557 tests + lint green):
      a. net-worth-hero.tsx:229 mainLabel="Net worth" (chart tooltip) -> t("stat.netWorth")
      b. shared-portfolio-view.tsx:154 label="Net worth" -> t("stat.netWorth")
      c. sidebar.tsx:117/134 "Collapse" text + "Expand/Collapse sidebar" aria-labels -> new keys (en+de+es)
      d. chart-controls.tsx:49-50 "Linear"/"Logarithmic" -> reuse t("sim.linear")/t("sim.logarithmic")
      e. rebalancing-view.tsx:397 donut center "Total" -> t("common.total") (analysis donut already shows GESAMT)
      f. allocation-pie.tsx:101 "No data" -> new key (en+de+es)
- [x] 6. Dividends page: forecast wrongly empty for a dividend payer bought today. perAsset skips assets with zero received payments; the forecast derived only from perAsset. Fixed: pure `projectDividends` in lib/finance/dividends.ts (trailing per-share events x current shares x fx), 7 new unit tests, 564 tests + lint green (764a6f0). Browser-verified: /dividends now shows 4 projected Apple payouts, 4,59 EUR total, USD->EUR converted; received figures stay 0 as they should.
- [x] 7. Each fix delegated (2x Sonnet, sequential, ledger updated before each), verified in-app, committed separately (01f4843, 764a6f0)
- [x] 8. New dictionary keys landed in en+de+es (parity suite green)

## Process
- [x] 9. CLAUDE.md updated (projectDividends forecast invariant in the dividends bullet)
- [x] 10. No branches; per-task commits on main
