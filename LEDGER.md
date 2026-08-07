# Ledger

## Done

- **2026-08-07 — TODO "Design v2" (first pass)** — session `429a4517`, one
  Sonnet subworker for the call-site conversions (verified by diff). The app
  rendered a KPI row two ways: nine surfaces grouped the figures in one card,
  five gave every figure its own, and the two shapes sat two tabs apart on
  /analysis. `StatRow` (`components/ui/primitives.tsx`) is now the only way to
  build one; /dividends, /analysis Trades, /simulation results and the asset
  detail's metrics moved onto it, dividends' skeleton included so the loading
  state matches the loaded one. /settings dropped its hairline-divided single
  card for one card per section (matching the two cards already above it), uses
  `PageHeader` + `SectionTitle`, pairs its short fields, and widened to
  `max-w-3xl`; its first card no longer repeats the page title
  (`settings.profileSection`). A lone tag group on Analysis "Eigene" now fills
  the card instead of sitting in the left half of a fixed 2-column grid.
  Deliberately NOT done: converting the 75 bare `<h2 class="text-lg
  font-semibold">` to `SectionTitle` (identical output, pure churn) and
  unifying chart-timeframe placement (the two hero cards put it with the chart
  it drives, which is defensible). Verified in Guest Mode at 1920x1080 with a
  seeded Alphabet position; no console errors.

- **2026-08-07 — TODO "Offen" (the Monte Carlo counts the pension)** — session
  `80fa00a4`, no subworker. The engine already subtracted a pension bridge, but
  only a FIRE link could hand it one. `usePensionBridge` (`lib/pension/`) is now
  the single derivation `useFireInputs` and the simulator both read, the
  withdrawal phase carries the same "Rente einrechnen" toggle, and the result
  names what the pension pays. Drive-by: `inflation` was missing from
  `hashSimParams` (a changed rate replayed the stale run), and `de` was never
  pinned against `en` — five `vpw` keys rendered in English, now translated and
  guarded by `tests/dictionaries-de.test.ts`.

- **2026-08-07 — TODO "Fällige Zahlungen" (automatic liability interest)** —
  session `bdb631a2`, no subworker. A liability's due interest now posts by
  itself (`interestIsAutomatic` + headless `AutoInterestBooker` in the provider
  tree); the recurring review, the skip action and the nav count all drop it,
  the list row says so, and credit interest on an asset account keeps its
  review. E2E `e2e/auto-interest.spec.ts` pins both halves. Drive-by: a stale
  4th argument in `tests/account-ledger.test.ts` had `tsc` red on HEAD.

- **2026-08-07 — TODO "Design - Prio Medium" (due-execution surfaces)** — session
  `51abceb2`, no subworker. Unified the recurring card's due list with the
  savings-plan review (notice + inline review directly under it, sortable table
  of editable date/amount rows), added per-row skip with its own account cursor
  (migration 0129), gave due account interest a nav notification, and moved
  "Buchung hinzufügen" into the bookings card.
