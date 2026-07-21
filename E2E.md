# End-to-end (browser) tests

Research answer to TODO "reproducible automated UI tests, not just unit-test,
like Selenium/Robot does" — plus the harness that answers it.

## Is there a need? Yes.

The 774-strong vitest suite is excellent but pins **pure functions** — the
finance core, resolvers, i18n parity. By construction it never boots a browser,
never mounts the provider chain, never exercises a form. Yet this app is almost
entirely `"use client"`, and its hardest invariant (the `lib/store` seam picking
`LocalStore` vs `SupabaseStore`) is pure *wiring*. That is exactly the class of
bug unit tests over pure functions miss: providers that don't compose, a mutation
that reaches the reducer but not localStorage, a chart that throws on mount, copy
that doesn't re-render on locale change. Until now the only guard against those
was **manual** Playwright driving (the `verify` skill) — real, but throwaway and
un-reproducible: nothing committed, nothing re-runnable, nothing a teammate or CI
can replay.

## Tool choice: Playwright (not Selenium / Robot Framework)

Selenium and Robot Framework are the classic answers, but they are the older,
heavier lineage: a separate WebDriver process, flakier waits, a Python/Java
runtime beside the Node app. **Playwright is the modern equivalent** — auto-waiting
locators (no manual sleeps), a bundled browser, first-class TypeScript so specs
live in the same language and `tsconfig` universe as the app, trace/screenshot
capture on failure, and a `webServer` block that boots the app for you so a run is
one command. It's also already the de-facto tool here: the `verify` skill drives
`playwright-core`. This just formalizes that into a committed, reproducible suite.

## What's built

- `@playwright/test@1.61.1` as a dev dependency. It reuses the **system-cached
  Chromium** (revision 1228) the machine already has — zero browser download.
- `playwright.config.ts` — `testDir: e2e`, 1080p viewport (owner rule), and a
  `webServer` that runs `npm run dev` so `npm run test:e2e` is self-contained.
- `e2e/helpers.ts` — shared drivers: `dismissTour`, `setLocale` (via Settings,
  the only place the switcher mounts), `openDashboard`, `addOtherAsset`,
  `openAssetDetail`.

**14 specs across the major surfaces** (all Guest Mode, all network-free):

- `smoke.spec.ts` — the app boots; switching locale in Settings re-renders
  another page's copy and updates `<html lang>` (EN/DE/ES).
- `seed-asset.spec.ts` — add an OTHER (manual-valuation) holding; it reaches the
  table + net-worth headline and **survives a reload** (localStorage rehydration).
  Exercises add-asset form → store seam → manual-valuation registry → holdings
  derivation → net-worth series → guest persistence, end to end.
- `navigation.spec.ts` — the sidebar reaches every primary route (analysis,
  dividends, xray, rebalancing, simulation); settings + the three legal pages
  render.
- `holdings.spec.ts` — the asset-detail page: core sections render; adding a
  valuation point updates the current value; a BUY appends to the transaction
  log; a tag group is created and a value assigned.
- `analysis.spec.ts` — the allocation chart mounts (`role="img"`) and the
  distributions/returns/trades tabs switch.
- `simulation.spec.ts` — runs the Monte Carlo **Web Worker** and renders the
  median-outcome tile (the single most integration-heavy flow).
- `settings.spec.ts` — changing the base currency flows through the store and
  **reformats the dashboard hero** into the new currency.
- `savings.spec.ts` — creating a savings plan via the dashboard card adds it.
- `export.spec.ts` — the CSV export triggers a real browser download; the file
  carries the `# FinTrack export` marker and the holding's name.

## Running

```bash
npm run test:e2e        # headless; boots its own dev server
npm run test:e2e:ui     # interactive Playwright UI mode
```

On a fresh machine that lacks the cached browser, run `npx playwright install
chromium` once.

## Constraints & conventions (read before adding specs)

- **Guest Mode only, locally.** `.env.local` carries no Supabase keys, so specs
  drive `LocalStore`. Registered-mode flows (auth, `SupabaseStore`, billing) can
  only be verified against the deployed app — out of scope for this suite.
- **Network-free by default.** The seed spec uses the OTHER asset precisely
  because it needs no Yahoo lookup or catalog — deterministic, no external
  dependency. Prefer flows that don't hit `/api/lookup`/`/api/quotes` so the
  suite stays reliable; if a spec must, mark it and expect flakiness.
- **Duplicate DOM nodes.** Tables render a desktop `<table>` *and* a hidden
  mobile list with the same text. Use `.filter({ visible: true })` (see the seed
  spec) so `.first()` doesn't grab the hidden copy.
- **The tour intercepts clicks.** A full-screen overlay auto-opens on the
  dashboard a beat after load; always `dismissTour` before interacting.
- E2E specs are **excluded from the app `tsconfig`** (Playwright transpiles them
  itself) so `next build` stays clean, and named `*.spec.ts` so vitest
  (`tests/**/*.test.ts`) never tries to run them.

## Incidental finding

The Settings form seeds its inputs (base currency, name, …) **once** from
`data.profile` at mount via `useState` initializers. On a hard reload of
`/settings`, if the component mounts before the async store load lands, those
inputs paint the default (EUR) even though the persisted profile is USD — the
control never re-syncs when `data` arrives. Persistence itself is fine (the
value is in localStorage and the dashboard reads it reactively); only the
settings control shows stale. Hence `settings.spec.ts` asserts through the
dashboard, not the settings form. Minor UX quirk, flagged for a possible follow-up.

## Not built (deliberate)

- **CI.** There's no `.github/workflows` yet; wiring `npm test` + `npm run
  test:e2e` (with `npx playwright install --with-deps chromium`) into Actions is
  the natural next step, left as a separate decision.
- **Network-dependent flows** (real add-asset lookup, watchlist add, dividends,
  live prices, historical charts) hit Yahoo/Frankfurter and would be flaky in a
  headless suite; covered by unit tests + manual `verify` instead.
- **Registered-mode E2E.** Needs a Supabase test project + seeded fixtures;
  bigger surface, deferred.
