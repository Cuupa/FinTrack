# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev       # start dev server (http://localhost:3000)
npm run build     # production build
npm run start     # serve production build
npm run lint      # ESLint
```

## Stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** + **Tailwind CSS v4**
- **Supabase** (`@supabase/ssr`, `@supabase/supabase-js`) — Postgres + Auth
- **Recharts 3** for all charts

The app is almost entirely **client-rendered** (`"use client"`): Guest Mode is
inherently browser-only, charts and the simulation worker are client-side, and
auth is interactive. There is no server-side data fetching layer.

## Setup

Copy `.env.example` → `.env.local` and fill in Supabase keys to enable
Registered Mode. **Without them the app runs fully in Guest Mode** — every
registered-only path is gated by `isSupabaseConfigured`.

## Database / SQL

`supabase/schema.sql` is the canonical full schema (fresh installs);
`supabase/migrations/*.sql` evolve existing databases. **When the data model
changes, update both in the same change, and keep every statement idempotent**
(`create table if not exists`, `add column if not exists`, `drop column if
exists`, `drop policy if exists` before `create policy`). Guard column
renames/backfills with `do $$ … $$` blocks that check `information_schema`.

## Architecture

### The central seam: store abstraction (`lib/store/`)

`DataStore` (`store/types.ts`) is implemented twice — `LocalStore`
(localStorage, Guest Mode) and `SupabaseStore` (Postgres, Registered Mode).
`createStore(supabase, userId)` (`store/index.ts`) picks one from auth state.
**UI and finance code never branch on the mode** — they call the store. This
is the most important invariant: keep mode-switching inside `lib/store`.

### State flow

Provider chain (`components/providers.tsx`): `AuthProvider` → `CatalogProvider`
→ `PortfolioProvider` → `LivePricesProvider`.
- `AuthProvider` (`lib/auth/`) tracks the Supabase session.
- `CatalogProvider` (`lib/catalog/`) loads the instruments catalog from the DB.
- `PortfolioProvider` (`lib/portfolio/`) recreates the store when `user.id`
  changes, loads data into memory, exposes mutations + `PortfolioData`.
- `LivePricesProvider` (`lib/live/`) polls live quotes + FX, exposes a
  `ValuationContext`.
  Components read via `usePortfolio()` / `useAuth()` / `useLivePrices()` /
  `useCatalog()`.

### Catalog in the database (not code)

The asset catalog (known instruments + provider quote symbols + country +
dividend yield) and ETF constituents live in Postgres (`instruments`,
`instrument_constituents`), seeded via SQL. `/api/catalog` serves them
(world-readable), `CatalogProvider` loads them into an in-memory cache
(`lib/catalog/catalog.ts`) that `lib/finance/prices.ts` reads synchronously.
**Do not reintroduce a hardcoded registry** — add rows to the DB + seed.
Without Supabase the cache is empty: auto-import and live quotes are
unavailable, synthetic pricing still works.

### Feature flags in the database (not env vars)

`feature_flags` holds a global on/off per feature (world-readable);
`user_feature_flags` holds per-user overrides that win over the global value.
Both are toggled by the owner via SQL/dashboard only. `FeatureFlagsProvider`
(`lib/flags/flags-context.tsx`) loads them; components gate via
`useFeatureFlag(...)`. Missing row / no Supabase ⇒ enabled. Gate a new feature
by seeding a row (migration + schema.sql) — never with env vars or the Vercel
Flags SDK (explicitly rejected).

### CSV import & fingerprints

`lib/import/csv.ts` parses broker exports (known German brokers + Bitpanda
precisely, a header-driven generic parser otherwise); names are replaced by the
official instrument name looked up via catalog → `/api/lookup`. Bitpanda's
header sits behind a PII preamble (detect by scanning the first lines); it maps
asset class Cryptocurrency→CRYPTO, Metal→COMMODITY (gold as `XAU`, grams kept),
Fiat→skipped, and in-asset fees convert to fiat via the row's market price. The
real broker CSVs at the repo root are **gitignored** (contain PII); tests use
inline anonymized fixtures plus `existsSync`-guarded full-file assertions. `lib/import/reconcile.ts`
fuzzy-matches rows against existing transactions; identical matches are filed
away silently, real conflicts go through a three-pane field-level merge.
Applied rows record a fingerprint (`imported_rows`) **tied to the transaction
id** — deleting the transaction/asset/portfolio cascades the fingerprint, so
re-imports surface correctly. UI rule: every destructive action gets a
`ConfirmDialog` first.

The app's own CSV export (`lib/export/export.ts`, "# FinTrack export" marker
line, assets + transactions sections) round-trips through the same seam: a
`fintrack` `BrokerFormat` in `csv.ts` parses it back, enriching rows from the
assets section (JSON re-import deliberately not implemented yet). Export
surfaces (dashboard `ExportMenu` + profile menu) are gated per format by the
`exportCsv` / `exportJson` feature flags.

### Live prices, FX & multi-currency

Real quotes come from `/api/quotes`: equities via **Yahoo Finance resolved by
ISIN** (the price key) — and crucially picking the listing whose currency
matches the asset's native currency, since one ISIN has listings in several
currencies (VWCE → EUR Xetra, not the USD London line). Stooq is the equity
fallback, CoinGecko prices crypto in the base currency. `/api/fx` (Frankfurter)
converts native→base. Each asset has a native `currency`; the finance layer
values everything in the base currency through a `ValuationContext`
({base, live, fx, fxHistory}) threaded into
`summarizeHolding`/`summarizeAll`/`netWorthSeries`/`assetPriceSeries`. Live
prices rescale the synthetic series so charts stay continuous (factor =
live/synthetic). Yahoo's endpoint is unofficial/keyless (can rate-limit), hence
the Stooq + synthetic fallbacks.

**Historical FX**: `/api/history` returns `{ histories, fx }` — one historical
rate series per unique native currency (`lib/server/fx-history.ts`, Frankfurter
timeseries, 12h in-memory TTL, shared with the benchmarks route). The chart
series functions (`netWorthSeries`/`twrSeries`/`holdingPeriodProfit`) look the
rate up per point date (`rateOn`, carry-forward; falls back to the spot `fx`
when no series is present), so a USD holding's multi-year EUR chart reflects
FX drift instead of today's spot everywhere. `summarizeHolding` (position,
basis, P&L snapshot) deliberately stays on spot; `instrument_history` stays
native-currency (convert-on-read — the base is per-user). The finance core
keeps zero `lib/server` imports (`rateAtCarryForward` is deliberately
duplicated, not imported).

### Real prices, history & lookup (shared `lib/server/yahoo.ts`)

- `/api/quotes` — current prices. `/api/history` — **real** historical series
  (the chart's synthetic walk is only a fallback). `/api/lookup` — auto-import
  metadata by ISIN/symbol. All resolve a listing via Yahoo, picking the one
  whose currency matches and whose exchange has deep data (Xetra over a thin
  regional line). History falls back to any listing with data and FX-converts.
- Because the catalog/quote symbols live in the DB, **equities still price &
  chart by ISIN even with no Supabase** (the catalog just adds the exact
  listing hint + crypto ids). Crypto needs the catalog (CoinGecko id).
- **German WKNs are not resolvable** by Yahoo/free sources — auto-import works
  by ISIN or symbol; WKN-only queries fall to manual entry.

### Analysis features

- `lib/finance/xray.ts` — ETF look-through: decomposes funds into constituent
  stocks (from `instrument_constituents`) + direct holdings → per-stock
  exposure (`/xray`).
- `lib/finance/allocation.ts` — pie-chart breakdowns by investment / class /
  currency / country / volatility (`/allocation`).
- Tags are grouped key-value pairs (e.g. `Strategie=gamble`): `TagsProvider`
  (`lib/tags/tags-context.tsx`) holds `groups` (customizable names, stable ids,
  rename/delete via the manager modal) and `assignments[assetId][groupId] =
  string[]`, persisted **localStorage-only** under `fintrack-tags` (versioned,
  lossless legacy migration into a default "Tags" group; disclosed in
  `/datenschutz`, deliberately not in the store seam). The Analysis "Custom"
  breakdown is switchable per group: `byCustom(holdings, assignments, groupId)`
  buckets holdings without a value in that group as "Untagged" (hardcoded
  sentinel, gray slice).
- `lib/finance/stats.ts` + portfolio Monte Carlo — per-asset μ/σ + correlation
  (Cholesky) drive the "My portfolio" simulation mode (`/simulation`).

### Watchlist & savings plans

`PortfolioData` also carries `watchlist` (instruments followed without
transactions; `watchlist_items` links to the instruments catalog like assets)
and `savingsPlans` (recurring buy rules; `savings_plans`, column `frequency`
since `interval` is a reserved type name). Both ride the full store seam —
LocalStore backfills, OfflineStore mirrors + queues, `lib/offline/sync.ts`
replays. Savings plans never touch the finance core:
`lib/finance/savings-plans.ts` derives due occurrences (pure), and the
dashboard card books them as ordinary BUY transactions only after an explicit
review dialog, advancing `lastRunDate`.

Instrument resolution is shared: all three add surfaces (add-asset form,
watchlist add, savings-plan inline new-asset) call `resolveInstrumentByQuery`
(`lib/import/resolve-instrument.ts`, catalog -> `/api/lookup`); the add-asset
identifier input auto-imports on blur/Enter. Watchlist items carry an optional
per-item `currency` override chosen in the add form ("Auto" = resolved native
currency); row pricing goes through the pure `pickWatchlistPrice`
(`lib/live/watchlist-price.ts`): the cron-cached catalog price is used only
when it agrees with the override, otherwise a one-shot `/api/price` fetch in
the override currency wins. Items link to `/instruments/[key]` (price key), the
shared detail view for non-held instruments: `AssetDetail` takes
`assetId | instrumentKey`, synthesizes an `Asset` from the watchlist item or
catalog row (`lib/finance/instrument-asset.ts`, sentinel ids `wl:`/`cat:`), and
offers "Add to portfolio" (embedded add-asset form) which flips the page to
the held view. The transaction form prefills from `valuation.live` and
refreshes equities via `/api/price` when the cached price is older than 1h
(`lib/live/fetch-price.ts` `isPriceFresh`/`fetchLivePrice`).

### Asset identity

Assets are identified by **ISIN/WKN** (not ticker). `symbol` is a nullable
field used only for assets without ISIN/WKN (crypto "BTC", commodities "XAU").
Two helpers in `lib/types.ts`: `assetPriceKey(asset)` (= `isin ?? wkn ?? symbol
?? name`, the price-lookup key) and `assetIdentifier(asset)` (display). The
add-asset form auto-imports name/ISIN/WKN **and the asset type** via
`lookupAsset(wkn|isin|symbol)`. Transactions store a full timestamp
(`Transaction.date` is an ISO datetime; DB column `transactions.executed_at`).

`AssetType` is `ETF | STOCK | CRYPTO | COMMODITY | CASH`. **COMMODITY** (e.g.
gold, symbol `XAU`) is symbol-only like crypto and prices like a normal
dividend-free security. It only ever comes from an explicit broker asset class
(Bitpanda "Metal") or the seeded catalog — the live `/api/lookup` cannot
represent it (`search.ts` drops Yahoo `FUTURE` hits; a bare metal ticker
mis-resolves to Tether Gold / an E-mini future), so `applyResolvedInstrument`
and `officialNameRenames` (`lib/import/resolve-names.ts`) **never let a lookup
override an authoritative COMMODITY name/type**. Adding a new `AssetType` breaks
`Record<AssetType,…>` sites at compile time (stats.ts `GENERAL`, allocation
buckets) — follow the compiler.

Market quotes may be in different **units** than the holding (gold: Yahoo
`XAUEUR=X` is per troy ounce, the user holds grams). `instruments.quote_scale`
(default 1) is the per-instrument multiplier, applied **after any FX** and
**only to the resolved market price** (never the synthetic series or stored
transaction prices) in the price cron, `/api/history`, and `/api/quotes` via
`lib/server/scale.ts`. Runtime live price = `instruments.last_price` (cron,
already scaled) surfaced by `LivePricesProvider`, not on-demand `/api/price`
(STOCK/ETF only).

The prices cron treats a COMMODITY row's stored `quote_id` as **authoritative**
(never re-resolved via search, row skipped if the hinted listing does not
resolve to itself) — Yahoo search on a bare metal ticker mis-resolves and once
put gold at 1.42 EUR. STOCK/ETF rows instead self-heal: once a day (03 UTC
hour) or on `?revalidate=1` the cron drops the stored hint so a stuck
mis-resolved `quote_id` re-resolves from scratch (the GME case); the bulk
`/api/cron/sync` forwards its query string to the prices sub-sync.

Listing resolution ranks in tiers (round 21, all three of
`resolveSymbol`/`resolveQuote`/`historyByQuery` in `lib/server/yahoo.ts`):
**exact-ticker match first, THEN the wanted-currency filter, then
volume/exchange score.** The currency filter must never run before the exact
tier — filtering "GME" to EUR-only candidates once left Geratherm Medical
(GME.F, an unrelated fuzzy hit and the only EUR line) as the winner, showing
GameStop at 2.63 EUR. Right instrument in the wrong currency (callers
FX-convert) always beats a wrong instrument in the right currency.

### Finance core (`lib/finance/`) — pure, no React

- `portfolio.ts` — holdings are **derived, never stored**: positions, cost
  basis (average-cost), realised/unrealised P&L, and the net-worth time series
  are all computed by replaying the transaction log. Holding reconstruction
  compares transactions by **day** (`dateKey`) since they carry a time.
  Transactions carry `fee` **and `tax`** — tax mirrors fee in all cash math
  (buy tax raises basis, sell tax reduces proceeds); `trades.ts` also builds
  the per-calendar-year tax report on /analysis (flag `taxReport`).
  `holdingPeriodProfit` divides by the capital exposed over the window
  (start-of-window value plus in-window BUY inflows), never by the
  start value alone: at tf=max the window starts at the first transaction,
  and a tiny day-one buy as sole denominator once produced +953%.
- `prices.ts` — **deterministic synthetic price provider** (seeded random walk
  keyed by the price key + a curated registry searchable by WKN/ISIN/symbol).
  Stands in for a real market-data API; the `PriceProvider` interface is the
  swap point for a real feed.
- `stats.ts` — estimates expected return + volatility from **historical data**
  (value-weighted daily returns of the user's holdings, annualised; benchmark
  fallback). This feeds the Monte Carlo defaults — μ/σ are measured, not assumed.
- `irr.ts` — money-weighted XIRR (Newton + bisection fallback).
- `monte-carlo.ts` — pure simulation, run off-thread via
  `monte-carlo.worker.ts` (`new Worker(new URL(...), import.meta.url)`).
- `dividends.ts` — dividends from **real events** (`/api/dividends`, Yahoo)
  scaled by shares held on each pay date; accumulating funds show none. The
  hinted listing (the quote symbol the app prices the asset with) is
  **authoritative in `dividendsByQuery`**: if it resolves, its event list is
  returned even when empty — never fall back to search candidates past a
  resolved hint, and never gate dividends by asset type or a flag (both were
  explicitly rejected). Scanning past an empty hint once imported an unrelated
  payer's events via the name-fallback search (the phantom gold-dividends
  case). Client-side, `useDividends` returns `{ dividends, loading }` (loading
  derived from the settled fetch signature, stale map kept meanwhile); the
  /dividends page shows skeletons while events are in flight.

### Routes

- `/` — dashboard: net-worth hero chart + add-asset + sortable/filterable
  table, plus the savings-plans card (flag `savingsPlans`) and watchlist card
  (flag `watchlist`)
- `/assets/[id]` — detail: price chart w/ buy/sell markers, IRR, dividends, P&L
- `/instruments/[key]` — same detail view for non-held instruments (watchlist
  click-through / catalog), reduced to master data + chart + look-through,
  with an embedded "Add to portfolio" form
- `/dividends` — dividend dashboard: income by month/year, personal yield +
  yield-on-cost, per-holding breakdown, 12-month forecast from trailing
  payouts (flag `dividends`)
- `/simulation` — Monte Carlo simulation
- `/login` — Supabase email/password + Google/GitHub OAuth
- `/impressum`, `/datenschutz`, `/terms` — legal pages (EN+DE content blocks,
  linked via `LegalFooter` in the root layout). The privacy policy makes
  verifiable claims about the code (server-side market-data calls, no
  analytics, essential-only storage, local history caching) — **keep it
  accurate when data flows change**. The legal contact email renders via
  `EmailImage` (`components/legal/legal-page.tsx`): drawn onto a canvas so the
  address never appears in the DOM (anti-scraping, user request) — never
  reintroduce it as text, a `mailto:` link, or an ARIA attribute. Operator
  identity (`site_config`) is served through a localStorage
  stale-while-revalidate mirror (`lib/site-config-cache.ts`,
  `useSyncExternalStore`, stable snapshot refs): cached values paint on the
  first client render, and the amber `Placeholder` chips appear only once
  loading has settled with the value still missing (`loaded` flag from
  `useSiteConfig`), so registered visitors never see a placeholder flash.

Note Next 16: dynamic `params` is a `Promise` — unwrap with `use(params)` in
client pages (see `app/assets/[id]/page.tsx`).

## Conventions & gotchas

- **German copy always uses the informal du-register** (user rule, absolute:
  applies to the dictionary, legal pages, and error pages alike; the earlier
  formal-"Sie" convention was explicitly overridden). Capitalized "Sie" is
  only acceptable as a genuine third-person pronoun at sentence start. No
  em-dashes in any user-facing copy.
- **Locales are en/de/es** (round 21). Spanish uses the informal tú-register.
  `tests/dictionaries-es.test.ts` pins en/es key AND `{placeholder}` parity —
  every new dictionary key must land in `es` (and `de`) or the suite fails.
  Legal pages deliberately stay EN+DE (es falls back to the English block).
- **Portfolios are brokers** (round 21, user rule): the user-given portfolio
  name IS the broker identity — never hardcode broker names or presets in the
  UI. Each portfolio carries a fee model (`fee_order_flat`,
  `fee_order_free_from`, `fee_savings_plan`) and a per-broker
  `tax_allowance` (Freistellungsauftrag). Fees only ever PREFILL the
  transaction/savings-plan fee inputs (`lib/finance/fees.ts`; a manual edit
  wins permanently). The tax report shields each broker's attributable gains
  with its own allowance; leftovers only offset the pooled remainder
  (dividends/Vorabpauschale) — see `taxYearBreakdown`. Settings edits one
  broker at a time behind a SelectMenu, never a stacked list of all
  portfolios (user rule: entity picker first, then its form).
- **Guided tours**: `TourOverlay` (components/onboarding/guided-tour.tsx) is
  the generic spotlight engine; page tours (risk, rebalancing, simulation,
  asset tags — `components/onboarding/page-tours.tsx`) persist completion in
  `profile.toursDone` (jsonb map, migration 0060) while the dashboard tour
  keeps `tourDoneAt`. Tours auto-start only where the page has data (mount
  placement, no enabled prop) and every tour surface has a ghost "?" replay
  button. Step registries live in `lib/onboarding/tour-steps.ts` (pure,
  unit-tested).
- **Dates** are timezone-stable `YYYY-MM-DD` strings throughout; use the
  helpers in `lib/finance/dates.ts`, not raw `Date` math.
- Next 16's `react-hooks/set-state-in-effect` lint rule **fails the build** on
  synchronous `setState` inside effects. Set state in async continuations
  (after `await`) or derive it instead of syncing via effect.
- Log-scale charts apply only in currency mode (log of negative % is
  undefined) — handled in `performance-chart.tsx`.
- **CSP** (`next.config.ts`, emitted in production only): `connect-src` allows
  only `'self'` + `*.supabase.co`. Any new **client-side** fetch to an external
  origin must be added there — or better, proxied through an API route
  (market-data calls are server-side by design).
- **All Yahoo traffic goes through `getJSON` in `lib/server/yahoo.ts`**, which
  carries the concurrency semaphore, 429/503 backoff + cooldown breaker, and
  TTL caches. Never fetch Yahoo endpoints directly from elsewhere.
- `shared_portfolios` inserts are **server-only** (secret key via
  `/api/share`; the anon RLS insert policy was dropped). The route enforces a
  256 KB payload cap and DB-backed rate limits. `instruments` has unique
  partial indexes on `isin`/`wkn` — `resolveInstrument` handles the 23505
  race by re-selecting.
- Historical series ride two cache layers: server-side `instrument_history`
  (per price key + range, 24h/7d staleness, inside `/api/history`) and a
  browser-local stale-while-revalidate layer (`lib/history/history-cache.ts`,
  used by `use-history.ts` behind the `historyCache` flag: cache hit paints
  immediately, a background fetch always revalidates; flag off = plain fetch).
  Cleared on sign-out; disclosed in `/datenschutz`. Heavy computation stays
  live and client-side on purpose — the finance math is cheap, the network
  round trip was the visible wait (round-13 caching decision).
- Synthetic-data labeling: `assetPriceSeries`/`netWorthSeries` return
  `{ points, synthetic/containsSynthetic }` and `HoldingSummary.syntheticPrice`
  feeds `EstimatedBadge` — new chart/price surfaces should keep the badge.
  `EstimatedBadge` is globally toggleable via the `estimated-badge` feature
  flag (`feature_flags` table, seeded enabled) — it renders nothing when
  disabled, so gating lives in the component, not each call site.
- Dialogs use the shared `use-focus-trap` hook (`components/ui/`); charts get
  `role="img"` + a dynamic localized `aria-label`; `t(key, params)` supports
  interpolation.
- Chart y-axes: never hardcode a `YAxis width` — compute it with `yAxisWidth`
  + `axisCurrencyFormatter` (`components/charts/axis.ts`) so the left gutter
    stays snug. `formatCompactCurrency` compacts with universal k/M/B suffixes
    in **every** locale (Intl's compact notation doesn't compact thousands in
    de-DE — that's why it exists).
- Form submit buttons disable on *presence only* (empty required fields) via
  `lib/forms/required.ts` (`useFormTouched` + amber `missingFieldCls`, hint key
  `form.missingFields`); content validation (valid number, > 0, …) stays at
  submit time. New forms should follow this pattern.
- Official-name resolution (catalog → `/api/lookup`, batches of 4,
  `lib/import/resolve-names.ts`) serves the CSV import; the former Holdings
  "Official names" button is gone — catalog names are re-synced by the
  `/api/cron/sync/names` job (marker `instruments.name_synced_at`).
- The login form deliberately has no required-field gating (user decision);
  after 3 consecutive failed sign-ins, submit is disabled with an exponential
  backoff countdown. New-password minimum is **8 chars** (signup +
  change-password only — sign-in never enforces a minLength, existing shorter
  passwords still work). Market-data APIs are DB-rate-limited per IP
  (`lib/server/rate-limit.ts`, fail-open without Supabase); `/api/cron/*`
  requires `CRON_SECRET` at the middleware edge.
- Allocation slice labels leave the pure finance layer as canonical English;
  the view translates the fixed vocabulary (asset classes, sectors in both
  Yahoo and GICS spellings, regions, volatility bands, sentinel buckets) via
  `translateSliceLabel` (`lib/i18n/slice-label.ts`) — unknown labels (country
  names, investment names, user tag values) pass through verbatim, never
  "translate" user data.
- `<html lang>` follows the active locale: SSR default `en`, an effect in the
  i18n provider stamps `document.documentElement.lang` on locale change.
- Guest-mode quota: `LocalStore.write` throws a tagged `StorageFullError`
  (`lib/store/errors.ts`, matched by name/code, never message text) when
  localStorage is full; every mutation surface shows the localized
  `common.storageFull` message instead of crashing. Keep new mutation call
  sites handling it.
- `SelectMenu` supports opt-in `searchable` (filter input in the popover) and a
  `footer` render prop (used for "+ New asset…" in the savings-plan form).
