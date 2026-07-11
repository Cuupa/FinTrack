# FinTrack

FinTrack is a portfolio tracker: add your holdings (stocks, ETFs, crypto,
commodities, cash), import broker CSVs, and see net worth, P&L, IRR,
dividends, allocation breakdowns and a Monte Carlo simulation, all computed
client-side from your transaction history.

It runs in one of two modes:

- **Guest Mode**: no account, no server. Everything lives in the browser's
  `localStorage`. Nothing to configure; data is lost if you clear browser
  storage.
- **Registered Mode**: sign in with Supabase (email/password or
  Google/GitHub OAuth). Data lives in Postgres and syncs across devices, with
  an offline mutation queue for spotty connections.

The app is almost entirely client-rendered (`"use client"` throughout):
Guest Mode is inherently browser-only, the charts and the Monte Carlo worker
are client-side, and auth is interactive. There is no server-side data
fetching layer for the UI itself; the only server code is a handful of API
routes that proxy market data and, in Registered Mode, Supabase.

## Setup

```bash
npm install
cp .env.example .env.local   # optional, see below
npm run dev                  # http://localhost:3000
```

Without any `.env.local` values, the app runs fully in Guest Mode:
portfolio data is local, equities and ETFs still price and chart by ISIN
(pulled live server-side), and everything except auth, cross-device sync and
the seeded instrument catalog works.

Other commands:

```bash
npm run build     # vitest run, then a production Next.js build
npm run start     # serve the production build
npm run lint      # ESLint
npx vitest run    # unit tests only
```

### Environment variables

See `.env.example` for the full, commented list. Summary:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. Set this (and a publishable key below) to enable Registered Mode. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side, RLS-scoped key. Either the new publishable key (`pk_...`) or the legacy anon JWT works. |
| `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Server-only, bypasses RLS. Used by the price/constituents/classification/ETF-breakdown cron routes and the history/benchmark cache writes. Never exposed to the browser. |
| `CRON_SECRET` | Bearer token the `/api/cron/*` routes require. Without it those routes run open (fine for local dev, not for a public deployment). |
| `FMP_API_KEY` | Optional. Enables Financial Modeling Prep as an ETF-constituents source beyond the SlickCharts-covered indices (S&P 500 / Nasdaq-100 / Dow). |

Feature flags are **not** environment variables; they live in the database
(`feature_flags` / `user_feature_flags` tables) so they can be toggled
per-user without a redeploy. See "Supabase setup" below.

There's also an optional, undocumented-in-`.env.example` `API_TOKEN` /
`NEXT_PUBLIC_API_TOKEN` pair read by `middleware.ts`: if `API_TOKEN` is set,
every `/api/*` route (other than `/api/cron/*`, which uses `CRON_SECRET`
instead) requires a matching bearer token. It's unset by default so Guest
Mode's market-data proxies stay open.

## Supabase setup

Registered Mode needs a Supabase project with the app's schema applied.

- **Fresh install**: run `supabase/schema.sql` against your project. It
  creates every table, RLS policy and seed row (reference `instruments`,
  `feature_flags`) in one idempotent pass.
- **Evolving an existing database**: apply `supabase/migrations/*.sql` in
  order. Every migration is idempotent (`create table if not exists`,
  `add column if not exists`, guarded backfills) and records itself in the
  `schema_migrations` table, so re-running an already-applied migration is a
  no-op.

Once the schema is in place, market data needs to be kept warm by the cron
routes under `app/api/cron/`:

- `/api/cron/sync`: runs every sub-sync in one call (prices, ETF
  constituents, classifications, official names, ETF sector/region/country
  breakdowns, benchmark history, shared-portfolio cleanup). Slow, and times
  out on some hosts, in which case call the sub-routes individually.
- `/api/cron/sync/prices`, `/constituents`, `/classifications`, `/names`,
  `/etf-breakdowns`, `/benchmarks`, `/shared-portfolios`: targeted refreshes.

All of them are `POST`-only and require `Authorization: Bearer $CRON_SECRET`
when `CRON_SECRET` is set. Point a scheduler at them (Vercel Cron, GitHub
Actions, any cron-capable host); the app itself never calls them.

## Architecture

- **Store seam** (`lib/store/`): `DataStore` is implemented twice,
  `LocalStore` (localStorage) and `SupabaseStore` (Postgres); `createStore()`
  picks one from auth state. UI and finance code only ever call the store
  interface, never branch on the mode.
- **Provider chain** (`components/providers.tsx`): `AuthProvider` then
  `CatalogProvider` then `PortfolioProvider` then `LivePricesProvider`, read
  via `useAuth()` / `useCatalog()` / `usePortfolio()` / `useLivePrices()`.
- **Finance core** (`lib/finance/`) is pure, framework-free TypeScript:
  holdings, cost basis and P&L are derived by replaying the transaction log,
  never stored directly.
- **Catalog in the database**: known instruments, provider quote symbols and
  ETF constituents live in Postgres (`instruments`,
  `instrument_constituents`), served by `/api/catalog` and cached in memory
  client-side. Without Supabase this cache is empty, so auto-import and live
  quotes are unavailable, but synthetic pricing still works.
- **Market data is fetched server-side**, never from the browser: equities
  and ETFs via Yahoo Finance (unofficial, keyless; see `lib/server/yahoo.ts`
  for the shared throttle/backoff/cache), Stooq as an equity fallback,
  CoinGecko for crypto, Frankfurter for FX.
- **Synthetic fallback**: when real data is unavailable (no Supabase, an
  unresolvable instrument, a rate-limited provider), a deterministic
  synthetic price series stands in so charts stay populated. Anywhere this
  happens, the UI surfaces an `EstimatedBadge` so a synthetic figure is never
  shown as if it were real.

See `CLAUDE.md` for the full set of conventions, invariants and gotchas
(i18n, dates, CSP, caching layers, feature flags, and more), and
`PROD_READY.md`, if still present, for the outstanding production-readiness
punch list.

## Testing

Tests run on [Vitest](https://vitest.dev) and live under `tests/`, covering
the finance core, the store implementations, CSV import/reconciliation,
formatting and other pure logic.

```bash
npx vitest run     # once
npx vitest          # watch mode
```
