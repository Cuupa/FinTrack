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

### Live prices, FX & multi-currency

Real quotes come from `/api/quotes`: equities via **Yahoo Finance resolved by
ISIN** (the price key) — and crucially picking the listing whose currency
matches the asset's native currency, since one ISIN has listings in several
currencies (VWCE → EUR Xetra, not the USD London line). Stooq is the equity
fallback, CoinGecko prices crypto in the base currency. `/api/fx` (Frankfurter)
converts native→base. Each asset has a native `currency`; the finance layer
values everything in the base currency through a `ValuationContext`
({base, live, fx}) threaded into
`summarizeHolding`/`summarizeAll`/`netWorthSeries`/`assetPriceSeries`. Live
prices rescale the synthetic series so charts stay continuous (factor =
live/synthetic). Yahoo's endpoint is unofficial/keyless (can rate-limit), hence
the Stooq + synthetic fallbacks.

### Analysis features

- `lib/finance/xray.ts` — ETF look-through: decomposes funds into constituent
  stocks (from `instrument_constituents`) + direct holdings → per-stock
  exposure (`/xray`).
- `lib/finance/allocation.ts` — pie-chart breakdowns by investment / class /
  currency / country / volatility (`/allocation`).
- `lib/finance/stats.ts` + portfolio Monte Carlo — per-asset μ/σ + correlation
  (Cholesky) drive the "My portfolio" simulation mode (`/planning`).

### Asset identity

Assets are identified by **ISIN/WKN** (not ticker). `symbol` is a nullable
field used only for assets without ISIN/WKN (crypto, e.g. "BTC"). Two helpers
in `lib/types.ts`: `assetPriceKey(asset)` (= `isin ?? wkn ?? symbol ?? name`,
the price-lookup key) and `assetIdentifier(asset)` (display). The add-asset
form auto-imports name/ISIN/WKN **and the asset type** via
`lookupAsset(wkn|isin|symbol)`. Transactions store a full timestamp
(`Transaction.date` is an ISO datetime; DB column `transactions.executed_at`).

### Finance core (`lib/finance/`) — pure, no React

- `portfolio.ts` — holdings are **derived, never stored**: positions, cost
  basis (average-cost), realised/unrealised P&L, and the net-worth time series
  are all computed by replaying the transaction log. Holding reconstruction
  compares transactions by **day** (`dateKey`) since they carry a time.
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
- `dividends.ts` — synthetic dividend history (yields keyed by ISIN).

### Routes

- `/` — dashboard: net-worth hero chart + add-asset + sortable/filterable table
- `/assets/[id]` — detail: price chart w/ buy/sell markers, IRR, dividends, P&L
- `/planning` — Monte Carlo simulation
- `/login` — Supabase email/password + Google/GitHub OAuth

Note Next 16: dynamic `params` is a `Promise` — unwrap with `use(params)` in
client pages (see `app/assets/[id]/page.tsx`).

## Conventions & gotchas

- **Dates** are timezone-stable `YYYY-MM-DD` strings throughout; use the
  helpers in `lib/finance/dates.ts`, not raw `Date` math.
- Next 16's `react-hooks/set-state-in-effect` lint rule **fails the build** on
  synchronous `setState` inside effects. Set state in async continuations
  (after `await`) or derive it instead of syncing via effect.
- Log-scale charts apply only in currency mode (log of negative % is
  undefined) — handled in `performance-chart.tsx`.
