# Ledger

## Done

- **2026-08-16 — Guided tour: critically re-audited EVERY step vs the current
  screen + added coverage for new surfaces** — session `2573ae55`. One Sonnet
  subworker audited read-only (keep/edit/drop), a second started the
  implementation but died on a session limit; main agent finished it.
  Fixed real bugs: the dashboard `addAsset` + `holdings` steps were PERMANENTLY
  dead (their anchors live only on /portfolio, which the dashboard tour never
  shows) -> dropped; /portfolio had no tour at all -> new `PORTFOLIO_TOUR_STEPS`
  (add positions, holdings, savings plans, watchlist) mounted via
  `PageHeaderWithTour`. `pension.points` copy contradicted the round-30 redesign
  ("one line per year" -> enter each letter's cumulative total). `accounts.list`
  promised a dead feature (`AccountBalancesDialog` unreachable) -> balances are
  ledger-derived. `navEveryday` still listed household (now its own nav group)
  -> new `navHousehold` step. Added 3 simulation steps (withdrawal strategy /
  stress test / comparison). Reordered `DEBT_TOUR_STEPS` to DOM order. Refreshed
  drifted bodies (netWorth, accounts.totals, simulation.withdrawal/model,
  risk.metrics VaR, pension.contracts, spending.form, assetTags.add) across
  en/de/es, all nebensatzfrei + no em-dashes. Fixed the wrong PENSION doc
  comment. Updated `tests/tour-steps.test.ts` (simulation now 7 steps). Full
  unit suite green (1276 passed), tsc clean.

- **2026-08-16 — Humanize copy: remove ALL subordinate clauses (Nebensätze) from
  the ENTIRE i18n dictionary, all three locales (en/de/es)** — session `2573ae55`,
  one Sonnet subworker (exhaustive in-file rewrite) after ~140 hand-done first.
  ~188 string values rewritten into short main clauses across en/de/es;
  placeholders + du/tú preserved, em-dashes removed (incl. "—" title separators
  -> colons, the rebalance "—" symbol -> "-"). Full unit suite green (1276
  passed, 4 skipped), parity 6/6, tsc clean. Style rule saved to memory
  (few-subordinate-clauses). Also removed the SSO buttons from /login (handler +
  buttons commented for easy re-enable, dictionary keys kept) and wrote the
  `styleguide` skill (.claude/skills/styleguide/).

- **2026-08-16 — Humanize copy: remove ALL subordinate clauses (Nebensätze) from
  the ENTIRE i18n dictionary, all three locales (en/de/es)** — session `2573ae55`,
  one Sonnet subworker (exhaustive in-file rewrite) after ~140 hand-done first.
  ~188 string values rewritten into short main clauses across en/de/es;
  placeholders + du/tú preserved, em-dashes removed (incl. "—" title separators
  -> colons, the rebalance "—" symbol -> "-"). Full unit suite green (1276
  passed, 4 skipped), parity 6/6, tsc clean. Style rule saved to memory
  (few-subordinate-clauses). Also removed the SSO buttons from /login (handler +
  buttons commented for easy re-enable, dictionary keys kept) and wrote the
  `styleguide` skill (.claude/skills/styleguide/).

- **2026-08-10 — TODO "Haushalt" (who owns what in a shared household)** —
  session `476e2bb1`, no subworker. Portfolios, accounts and assets all already
  carry a DB `user_id`; it was never surfaced. Added a read-only `ownerId` to
  the `Portfolio`/`Account`/`Asset` domain types (excluded from the `*Input`
  writes), mapped from `user_id` in `SupabaseStore` (base-column selects, so no
  migration risk), and a pure owner-name resolver + `useOwnerLabel` hook
  (`lib/household/owner.ts` + `use-owner-label.ts`, unit-tested). An **Owner**
  column now appears on the holdings table, the accounts list and the spending
  ledger, and the settings broker picker appends the owner — but only when the
  household is actively sharing across more than one member (`ownershipVisible`),
  so a solo user sees no change. Self reads as "du", a peer as their email
  (mirrors the members list). No badges; sortable columns; owner UUID kept out
  of the LLM context and exports (both pick fields explicitly).
  **Not verified in-browser**: renders only for REGISTERED household users,
  which local dev cannot be (guest-only, no Supabase keys). Guest-mode path
  confirmed unchanged (column hidden, /portfolio + /accounts + /spending 200,
  no compile errors); unit suite green (1272 passing), tsc + lint clean.

- **2026-08-09 — Design v2 follow-ups** — session `429a4517`, two Sonnet
  subworkers (one for the nav move, verified by diff; a second for the month
  filter died on a session limit after only adding the three dictionary keys,
  so that feature was written here). Commits `ae1a638` + `effbbc0`.
  Due occurrences now carry an editable **datetime** on both surfaces: the
  recurring review posted at "whenever you clicked" and the savings-plan review
  rendered its date as static text with a hardcoded midnight and no picker at
  all, though CLAUDE.md already required one. Both review panels are capped
  (`max-w-5xl`) because at full width their few columns spread until the amount
  input sat a thousand pixels from its row. The account entry moved out of the
  sidebar footer into the top bar's rightmost slot (owner override of the
  round-28 rule; `ProfileMenu`'s `sidebar` variant is gone and the popover now
  opens downward). `MonthPicker` gives /accounts and /cashflow one page-level
  month filter with a clearable "all months"; the Sankey and the accounts hero
  hide their own window controls while a month is set, and the forecast is
  exempt by owner rule. Drive-by: the asset detail's Details card no longer
  stretches to its taller neighbour (`items-start`).
  Verified in Guest Mode at 1920x1080. **Not verified in-browser**: the account
  avatar's new top-bar position renders only for REGISTERED users, which local
  dev cannot be (no Supabase keys) — code-reviewed only, and the sidebar's
  account row is confirmed gone.

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
