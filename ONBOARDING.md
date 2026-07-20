# ONBOARDING.md - first-run experience

Status: DESIGN (round 20, 2026-07-12). Phase 1 (guided tour) ships this round;
later phases are planned here and stay deferred until asked.

## Problem

A new user (guest or freshly registered) lands on a dashboard whose hero chart,
holdings table and analysis pages are all empty. Nothing explains what the app
can do or what the first step is. The standing "onboarding/demo portfolio"
deferral exists since round 18; this document turns it into a plan.

## Goals, in order

1. **Orientation**: show what exists (add assets, import CSV, charts, analysis,
   dividends, simulation) in under a minute.
2. **Activation**: get the first transaction or CSV import booked.
3. **Never nag**: everything here fires once, is skippable at every step, and
   is trivially re-runnable from settings.

## Phases

| Phase | What | Status |
|---|---|---|
| 1 | Guided tour on first dashboard visit | ships round 20 |
| 2 | Demo portfolio (one click seeds clearly-labeled sample data, one click removes it) | deferred |
| 3 | Empty-state action cards (dashboard zero-state offers: add asset / import CSV / try demo) | deferred |
| 4 | Progress checklist card (first asset, first import, explored analysis, set base currency) | deferred, likely never (nag risk) |

Phase 2 notes for later: seed via the ordinary store mutations (rides the seam,
works in guest mode), tag the portfolio visually as "Beispieldaten" everywhere,
removal deletes exactly the seeded rows. Requires curated realistic seed prices
(the demo account's wildly unrealistic seeds were flagged in round 17).

## Phase 1: guided tour (v1 scope, implemented this round)

A step-by-step spotlight tour over the real dashboard. No third-party tour
library: the need is one overlay, one measured rectangle and a tooltip card;
a dependency would bring its own CSS/positioning system into a strict-CSP,
Tailwind-only app for no benefit.

### Trigger and persistence

- `Profile` gains `tourDoneAt: string | null` (ISO datetime, null = tour never
  completed or skipped). Rides the store seam like `theme`/`locale`:
  `lib/types.ts` + `DEFAULT_PROFILE`, `supabase-store` select list + read
  mapping + upsert, migration `0057_profile_tour.sql`
  (`alter table public.profiles add column if not exists tour_done_at
  timestamptz;`, registered, schema.sql mirrored). LocalStore merges defaults
  already, so guests persist it too.
- The tour renders on the dashboard when ALL hold: portfolio `loading` false,
  no `loadError`, `profile.tourDoneAt == null`, and it was not closed this
  session. The open state is **derived** (plus a local `closed` flag set only
  in click handlers), never synced via effect
  (`react-hooks/set-state-in-effect` fails the build).
- Finishing OR skipping writes `tourDoneAt = now` via `updateProfile`; both
  paths also set the local `closed` flag so the UI closes even if the write
  fails. `StorageFullError` is caught per convention (tour still closes, no
  crash, no message needed: nothing was lost).
- Registered user on a new device: profile loads with `tourDoneAt` set, no
  tour. Guest who later registers: fresh profile, tour offers itself once
  more, acceptable.

### Steps (v1, dashboard only)

| # | Target (`data-tour`) | Content |
|---|---|---|
| 1 | none (centered card) | Welcome: what FinTrack is, "takes ~1 minute", start/skip |
| 2 | `add-asset` (header button, app/page.tsx) | Add holdings manually or import a broker CSV |
| 3 | `net-worth` (NetWorthHero root) | Net worth over time, timeframe switch |
| 4 | `holdings` (AssetTable root) | Holdings table: sortable, click a row for details |
| 5 | `nav` (sidebar nav group) | Analysis, dividends, simulation live here |
| 6 | `theme-toggle` (nav toggle) | Dark mode + settings pointer |
| 7 | `privacy-toggle` (nav toggle) | Privacy mode: blur every amount on screen, handy in public / screen-sharing |
| 8 | none (centered card) | Done: suggested first step is adding an asset or importing a CSV; points to settings for language/currency and "tour again" |

Steps whose target element is not in the DOM (feature flag off, mobile layout
hiding the sidebar) are skipped automatically at render time; centered steps
always work, so mobile keeps at minimum welcome + done plus whatever targets
its layout has.

### Mechanics (`components/onboarding/guided-tour.tsx`)

- Targets are marked with `data-tour="..."` attributes at the sites above
  (one attribute per site, no coupling to the tour component).
- Spotlight: fixed full-viewport layer; the active target is measured with
  `getBoundingClientRect`, highlighted by an absolutely positioned rounded
  rectangle carrying `box-shadow: 0 0 0 9999px` scrim (Tailwind arbitrary
  value), pointer-events disabled outside the tooltip.
- Measurement re-runs on window resize/scroll (listeners + rAF) and on step
  change; the target is scrolled into view (`block: "center"`) when advancing.
  Rect state is set only in rAF/event continuations, never synchronously in an
  effect body.
- Tooltip card: step title + body, Back / Next (Finish on the last step),
  "Tour überspringen" ghost button, progress dots. Positioned below the target
  rect, flipping above when there is no room, clamped to the viewport.
- A11y: `role="dialog"` + `aria-modal`, shared `useFocusTrap` on the card,
  localized `aria-label`s, Esc = skip, ArrowRight/ArrowLeft = next/back.
- Dark mode via `dark:` utilities only (class-based theming rule).
- i18n: `tour.*` keys, EN==DE, du register, no em-dashes.

### Re-run entry point

Settings gets a small "Tour" card: one line of copy plus a button that clears
`tourDoneAt` (via `updateProfile`) and navigates to the dashboard, where the
derived condition opens the tour again.

### Explicitly out of scope for v1

- Tour steps on other routes (asset detail, analysis): v1 points at the nav
  instead of navigating mid-tour.
- Demo portfolio (Phase 2), empty-state cards (Phase 3).
- Any tracking of tour progress beyond done/not-done: no analytics, per the
  privacy policy.

### Acceptance criteria

- Fresh guest visit: tour opens once after the dashboard loads; skipping in
  step 1 never shows it again (reload-proof); finishing likewise.
- Registered account: `tour_done_at` persists across devices.
- Settings button re-opens the tour on the dashboard.
- Feature-flagged targets off or narrow viewport: affected steps are skipped,
  tour completes cleanly.
- Lint (incl. `set-state-in-effect`), build, full test suite green in both env
  runs; EN==DE key parity; browser-verified EN+DE x light/dark at 1920x1080
  plus a narrow viewport, zero console errors.
