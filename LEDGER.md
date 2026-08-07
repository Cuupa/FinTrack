# Ledger

## Done

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
