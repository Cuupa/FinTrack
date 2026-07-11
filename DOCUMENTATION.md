# FinTrack: The Complete Handbook

This document explains the entire FinTrack application: what it does, how it is
built, why it is built that way, and where to go in the code to change any
specific thing. It is written for a reader with **no prior knowledge of this
project or of Next.js**. Technical terms are explained the first time they
appear, and there is a glossary in section 3.

It was produced by analyzing the full codebase and the complete git commit
history (roughly 280 commits between 2026-06-26 and 2026-07-11), plus the
project's internal design documents (`LEDGER.md`, `PRD.md`, `ROADMAP.md`,
`OFFLINE_DESIGN.md`, `PROD_READY.md`).

**How to use this document:**

- To understand *what the app does*: read sections 2 and 3.
- To understand *how the code is organized*: read sections 4 and 5.
- To understand *why it is built the way it is*: read sections 6 to 9.
- To *make a specific change*: jump straight to section 10, the cookbook,
  which maps common changes to exact files.
- To understand *how the app got here*: read section 11 (history and
  war stories) and section 12 (timeline).

---

## Table of contents

1. [What FinTrack is](#1-what-fintrack-is)
2. [A tour of the app, page by page](#2-a-tour-of-the-app-page-by-page)
3. [Glossary](#3-glossary)
4. [The technology stack, explained](#4-the-technology-stack-explained)
5. [Repository map: what lives where](#5-repository-map-what-lives-where)
6. [The architecture: seven load-bearing decisions](#6-the-architecture-seven-load-bearing-decisions)
7. [The database](#7-the-database)
8. [The market-data pipeline](#8-the-market-data-pipeline)
9. [Business logic: the domain rules](#9-business-logic-the-domain-rules)
10. [Cookbook: "I want to change X"](#10-cookbook-i-want-to-change-x)
11. [History and war stories: why certain rules exist](#11-history-and-war-stories-why-certain-rules-exist)
12. [Project timeline](#12-project-timeline)
13. [Working on the code: setup, tests, conventions](#13-working-on-the-code-setup-tests-conventions)
14. [Map of the other documents in this repository](#14-map-of-the-other-documents-in-this-repository)

---

## 1. What FinTrack is

FinTrack is a **web-based portfolio tracker** for private investors. You tell
it what you bought and sold (stocks, ETFs, cryptocurrency, gold, cash), and it
computes and visualizes everything else:

- your total net worth over time,
- profit and loss per holding (realized and unrealized),
- returns (time-weighted and money-weighted),
- dividend income, past and forecast,
- how your money is spread across countries, sectors, currencies and asset
  classes,
- risk metrics (volatility, drawdown, beta/alpha against an index),
- and a Monte Carlo simulation of how your wealth might develop in the future.

The product targets German-speaking retail investors (the UI is fully
bilingual English/German, broker CSV imports cover German brokers, and the tax
handling models German Abgeltungsteuer), but nothing prevents general use.

### The single most important product idea: two modes, one app

FinTrack runs in one of two modes, and **every feature works in both**:

- **Guest Mode**: no account, no server-side storage. All portfolio data
  lives in the browser's `localStorage` (a small key-value storage every
  browser provides per website). Nothing to sign up for; data is lost if the
  browser storage is cleared and never leaves the device.
- **Registered Mode**: sign in via Supabase (email/password or Google/GitHub).
  Data lives in a Postgres database in the cloud and synchronizes across
  devices. An offline queue records changes made without a connection and
  replays them when the connection returns.

This dual-mode requirement shaped the whole architecture (see section 6.1).

### The second most important idea: nothing is stored that can be derived

FinTrack never stores "you own 12 shares of Apple". It stores the
**transactions** (bought 10 on date X, bought 5 on date Y, sold 3 on date Z)
and **re-derives** holdings, cost basis, profit and every chart from that
transaction log, every time. This makes the numbers impossible to get out of
sync with the history, and it makes editing or deleting a past transaction
"just work". See section 6.3.

### The third: honesty about data quality

Market data comes from free, unofficial sources that sometimes fail. When
FinTrack has to fall back to a synthetic (made-up but deterministic) price
series so charts stay populated, the UI always shows an **"Estimated" badge**
next to the affected number or chart. Synthetic data is never silently
presented as real. See sections 6.6 and 11.

---

## 2. A tour of the app, page by page

Every page lives under the `app/` directory (this is how Next.js maps folders
to browser URLs; see section 4). The page file is usually a thin wrapper; the
real UI lives in `components/`.

| URL | What the user sees | Main code |
| --- | --- | --- |
| `/` | **Dashboard**: hero chart of total net worth (with timeframe, linear/log scale, currency/percent toggles, and benchmark index overlay), an "add asset" panel, the sortable holdings table with profit columns, a collapsed section for sold-off past holdings, the savings-plans card, and the watchlist card. | `app/page.tsx`, `components/dashboard/`, `components/assets/asset-table.tsx`, `components/charts/` |
| `/assets/[id]` | **Asset detail** for a holding: price chart with buy/sell markers, master data (ISIN/WKN with copy buttons), position metrics (shares, cost basis, IRR, dividends received, fees, P&L), the transaction list with edit/delete, and an add-transaction form. | `app/assets/[id]/page.tsx`, `components/assets/asset-detail.tsx`, `components/assets/transaction-form.tsx` |
| `/instruments/[key]` | The **same detail view** for an instrument the user does *not* hold yet (opened from the watchlist or catalog). Shows the same layout with zero-state metrics; submitting the first transaction creates the holding on the spot. | `app/instruments/[key]/page.tsx`, same `asset-detail.tsx` |
| `/analysis` | **Analysis**: tabs for Returns (TWR charts per scope), Trades (winners/losers, per-year tax report behind the `taxReport` flag), and Risk (volatility, drawdown, VaR, beta/alpha vs. MSCI World, correlation matrix). | `app/analysis/page.tsx`, `components/analysis/` |
| `/allocation` | **Allocation** pie breakdowns: by investment, asset class, currency, country, region, sector, volatility band, and by the user's own tags. | `components/allocation/` , `lib/finance/allocation.ts` |
| `/xray` | **ETF X-Ray**: decomposes ETFs into their constituent stocks and merges them with direct holdings, answering "how much Apple do I really own across everything?" | `app/xray/page.tsx`, `lib/finance/xray.ts` |
| `/rebalancing` | **Rebalancing**: target-allocation comparison with deviation, including a buy-only mode (rebalance with new money instead of selling). | `app/rebalancing/page.tsx`, `components/rebalancing/` |
| `/dividends` | **Dividend dashboard**: income by month/year, personal yield and yield-on-cost, per-holding breakdown, 12-month forecast from trailing payouts. Behind the `dividends` feature flag. | `app/dividends/page.tsx`, `components/dividends/` |
| `/simulation` | **Monte Carlo simulation**: projects future wealth with thousands of random runs. Parameters (expected return, volatility) are *measured from the user's own portfolio history*, including cross-asset correlations. Supports savings phases, withdrawal phases, safe-rate comparison. | `app/simulation/page.tsx`, `components/simulation/`, `lib/finance/monte-carlo.ts` |
| `/shared/[id]` | A **read-only shared portfolio view** opened via a share link, optionally live-updating and optionally "incognito" (absolute money values hidden). | `app/shared/`, `components/shared/` |
| `/login` | Sign in / register (email+password, Google, GitHub). | `app/login/page.tsx` |
| `/settings` | Profile settings: display name, base currency, language, password change, account deletion. | `app/settings/page.tsx`, `components/settings/` |
| `/admin` and subpages | **Admin backend** (visible only to seeded admins): overview health tiles, feature-flag editor, site-config editor, instrument price health with revalidation, error-log viewer, audit trail. | `app/admin/`, `lib/admin/`, `lib/server/require-admin.ts` |
| `/impressum`, `/datenschutz`, `/terms` | Legal pages (German law requires an Impressum and privacy policy). Bilingual. | `app/impressum/` etc., `components/legal/` |
| `/system` | Shows which database migrations are applied. | `app/system/page.tsx` |

Cross-cutting UI elements: a collapsible icon **sidebar** for navigation
(`components/sidebar.tsx`, `components/mobile-nav.tsx`), a **profile menu**
with locale switcher and export options (`components/profile-menu.tsx`), a
**privacy toggle** that blurs all money amounts for over-the-shoulder privacy
(`components/privacy-toggle.tsx`), a **guest banner** reminding guests their
data is local-only, and **offline/sync status banners**.

There is also a machine-facing side: everything under `app/api/` is a server
endpoint (see sections 5 and 8), including the cron endpoints that keep market
data fresh.

---

## 3. Glossary

Finance terms:

- **Instrument**: anything tradeable: a stock, an ETF, a cryptocurrency, a
  commodity like gold.
- **ETF**: a fund that holds many stocks at once and trades like a single
  share. Because one ETF contains hundreds of companies, FinTrack has
  "look-through" features that decompose it.
- **ISIN / WKN**: identification numbers for securities. ISIN is the
  12-character international one (e.g. `IE00BK5BQT80`); WKN is the 6-character
  German one. FinTrack identifies assets by ISIN/WKN, *not* by ticker symbol,
  because tickers are ambiguous across exchanges. WKNs cannot be resolved by
  free data sources, so auto-import needs the ISIN or a symbol.
- **Holding / position**: how much of one instrument you currently own.
- **Cost basis**: what you paid in total for your current shares (FinTrack
  uses the average-cost method). The baseline against which profit is
  measured.
- **Realized vs. unrealized P&L**: profit that was locked in by selling vs.
  paper profit on shares still held.
- **IRR / XIRR (money-weighted return)**: the yearly interest rate a bank
  account would have needed to match your exact deposits and withdrawals. It
  answers "how did *my money* do?".
- **TWR (time-weighted return)**: strips out the effect of when you added or
  removed money. It answers "how did *the investments themselves* do?" and is
  the right basis for comparing against an index.
- **Benchmark**: a market index (MSCI World, S&P 500, DAX, ...) to compare
  your performance against.
- **Volatility (σ)**: how strongly a value fluctuates; the standard deviation
  of returns, annualized.
- **Drawdown**: the largest peak-to-trough loss over a period.
- **Beta / alpha**: how strongly a portfolio moves with a benchmark (beta) and
  the excess return unexplained by that co-movement (alpha).
- **Monte Carlo simulation**: running thousands of randomized "possible
  futures" to see a probability range instead of a single guess.
- **FX**: foreign exchange, i.e. currency conversion. A US stock is priced in
  USD but a German user wants to see EUR, so historical and current FX rates
  matter (see sections 8 and 11).
- **Abgeltungsteuer**: German flat capital-gains tax withheld on sells.
  Transactions carry a `tax` field for it.
- **Sparplan (savings plan)**: a recurring automatic buy, e.g. "100 EUR of
  this ETF every month".
- **Knock-out warrant / Zertifikat**: a leveraged German derivative. Relevant
  here mainly because free data sources cannot price them (see war story
  11.4).

Technical terms:

- **Frontend / client-side**: code running in the user's browser.
  **Backend / server-side**: code running on the server. FinTrack is unusual
  in that almost all logic is client-side (section 6).
- **localStorage**: a small per-website storage area inside the browser.
  Guest Mode lives entirely there.
- **API route / endpoint**: a URL that returns data (JSON) instead of a page.
  All of FinTrack's server code is API routes under `app/api/`.
- **Cron job**: a task that runs on a schedule (e.g. "refresh all prices every
  hour"). FinTrack's cron endpoints are triggered by an external scheduler.
- **Migration**: a SQL script that upgrades an existing database from one
  schema version to the next.
- **RLS (Row Level Security)**: a Postgres feature Supabase uses so that each
  user can only read/write their own rows, enforced in the database itself.
- **Feature flag**: an on/off switch for a feature, changeable without
  deploying new code. FinTrack keeps these in the database (section 6.5).
- **PWA (Progressive Web App)**: a website that can be installed like an app
  and partially works offline, via a "service worker" (a background script
  that intercepts network requests and serves cached responses).
- **Hydration / SSR**: Next.js first sends HTML from the server, then
  JavaScript "wakes it up" in the browser. FinTrack renders nearly everything
  in the browser ("client components").
- **Synthetic price series**: a deterministic fake price history generated
  from a random walk seeded by the instrument's identifier, used only as a
  last-resort fallback and always labeled "Estimated".

---

## 4. The technology stack, explained

If you have never worked with a modern web project, here is what each piece
is and why FinTrack uses it. Exact versions are in `package.json`.

- **TypeScript**: JavaScript with type annotations. Types let the compiler
  catch mistakes ("this function needs a number, you passed text") before the
  code runs. FinTrack leans on this deliberately: for example, adding a new
  asset type to the `AssetType` union in `lib/types.ts` makes the compiler
  point at every place that must be updated.
- **React 19**: the UI library. The screen is described as a tree of
  "components" (small reusable functions returning HTML-like markup), and
  React re-renders whatever depends on data that changed.
- **Next.js 16**: the framework around React. Two things matter for this
  project:
  1. **File-based routing**: a folder `app/dividends/page.tsx` automatically
     becomes the page at `/dividends`. A folder `app/api/quotes/route.ts`
     becomes the server endpoint `/api/quotes`. Square brackets are
     placeholders: `app/assets/[id]/page.tsx` serves `/assets/<any-id>`.
  2. **Client components**: files starting with `"use client"` run in the
     browser. Almost every FinTrack component does, because Guest Mode
     (browser storage), charts and the simulation worker are inherently
     browser things. There is deliberately **no server-side data fetching
     layer for the UI**; the server exists only to proxy market data and, in
     Registered Mode, Supabase.
  - Next 16 quirk: in client pages, route parameters arrive as a Promise and
    must be unwrapped with `use(params)` (see `app/assets/[id]/page.tsx`).
  - Next 16 quirk: a lint rule (`react-hooks/set-state-in-effect`) **fails
    the build** if state is set synchronously inside an effect. State is set
    in async continuations (after an `await`) or derived instead.
- **Tailwind CSS v4**: styling via utility classes written directly in the
  markup (`className="flex gap-2 text-sm"`). There is no separate CSS file
  per component; to restyle something, edit its `className` strings.
- **Recharts 3**: the charting library used for every chart.
- **Supabase**: a hosted Postgres database plus authentication service.
  FinTrack uses it for Registered Mode accounts and data, for the shared
  instrument catalog, and for operational tables (flags, error logs, rate
  limits). The client libraries are `@supabase/supabase-js` and
  `@supabase/ssr` (cookie-based sessions).
- **Vitest**: the test runner. `npm run build` runs the full test suite
  *before* building, so a red test blocks deployment by design.
- **Vercel**: the hosting platform the project deploys to (see
  `OPERATIONS.md`). Pushing to `main` deploys production.

### Commands

```bash
npm run dev       # start the dev server at http://localhost:3000
npm run build     # run all tests, then produce a production build
npm run start     # serve the production build
npm run lint      # ESLint
npx vitest run    # tests only
```

`npm run build` also runs `scripts/generate-sw-version.mjs` first (the
`prebuild` script), which writes the current commit hash into the gitignored
`public/sw-version.js`; the service worker (`public/sw.js`) imports it, so
every deploy automatically invalidates the previous offline cache. Never
hand-edit a version number into `sw.js`.

### Environment variables (`.env.local`)

Copy `.env.example` to `.env.local`. **With no variables at all, the app runs
fully in Guest Mode.** Summary:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. Setting this (plus a key below) enables Registered Mode. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `..._ANON_KEY` | Browser-side key, restricted by Row Level Security. |
| `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Server-only key that bypasses RLS; used by cron routes and cache writes. Never sent to the browser. |
| `CRON_SECRET` | Bearer token required by `/api/cron/*` (enforced in `middleware.ts` at the edge). |
| `API_TOKEN` / `NEXT_PUBLIC_API_TOKEN` | Optional: if set, every other `/api/*` route requires this bearer token. Unset by default so Guest Mode's market-data proxies stay open. |
| `FMP_API_KEY` | Optional: extra ETF-constituents data source. |

Feature flags are deliberately **not** environment variables (section 6.5).

---

## 5. Repository map: what lives where

Top level:

```
app/                  Pages and API endpoints (Next.js routing)
components/           React UI components, grouped by feature
lib/                  All non-UI logic (the heart of the app)
supabase/             Database schema, migrations, demo seed
tests/                Vitest unit/integration tests
scripts/              Build helpers (service-worker version stamping)
public/               Static files incl. the service worker (sw.js)
middleware.ts         Edge gate: CRON_SECRET / API_TOKEN checks
next.config.ts        Next.js config incl. the Content Security Policy
*.md                  Documentation (see section 14)
```

`lib/` in detail, because that is where almost every meaningful change lands:

| Directory | Contents |
| --- | --- |
| `lib/types.ts` | The core domain model: `Asset`, `Transaction`, `Portfolio`, `WatchlistItem`, `SavingsPlan`, `Profile`, `PortfolioData`, plus the identity helpers `assetPriceKey` / `assetIdentifier`. Read this file first. |
| `lib/store/` | The **storage seam** (section 6.1): `types.ts` defines the `DataStore` interface; `local-store.ts` (Guest Mode), `supabase-store.ts` (Registered Mode), `offline-store.ts` + `mutation-queue.ts` (offline layer), `index.ts` picks the implementation, `errors.ts` (tagged storage-full error). |
| `lib/finance/` | The **pure finance core** (section 6.3): portfolio math, prices, returns, IRR, stats, Monte Carlo, dividends, allocation, x-ray, trades, savings-plan scheduling, date helpers. No React, no network, no storage in here. |
| `lib/server/` | Server-only helpers used by API routes: `yahoo.ts` (the single gateway to Yahoo Finance), `fx-history.ts`, `search.ts`, `onvista.ts`, `classify.ts`, `constituents.ts`, `scale.ts` (quote_scale), `rate-limit.ts`, `require-admin.ts`, `supabase-keys.ts`. |
| `lib/portfolio/` | `PortfolioProvider`: loads data through the store into memory, exposes mutations to the UI. |
| `lib/auth/` | `AuthProvider`: tracks the Supabase session. |
| `lib/catalog/` | Loads the instrument catalog from the DB into an in-memory cache. |
| `lib/live/` | Live price polling (`LivePricesProvider`), one-shot price fetch + freshness check, watchlist price precedence. |
| `lib/flags/` | Feature-flag context (`useFeatureFlag`). |
| `lib/i18n/` | Localization: `dictionaries.ts` (every UI string, EN + DE), context, locale helpers, `slice-label.ts` (chart label translation). |
| `lib/import/` | CSV import: `csv.ts` (broker parsers), `reconcile.ts` (fuzzy matching against existing transactions), `resolve-instrument.ts`, `resolve-names.ts`. |
| `lib/export/` | CSV/JSON export. |
| `lib/history/` | Historical price series fetching + browser-local cache, dividends hook. |
| `lib/offline/` | Connectivity probe, sync context, reconnect replay logic. |
| `lib/tags/` | User tag groups (localStorage-only, section 9.8). |
| `lib/share/` | Share-link payload building and consumption. |
| `lib/admin/` | Admin backend client helpers and pure stats/health functions. |
| `lib/privacy/` | The blur-values privacy toggle state. |
| `lib/errors/` | Client error reporting to the self-hosted error log. |
| `lib/forms/` | Shared required-fields form gating. |
| `lib/format.ts`, `lib/ticks.ts`, `lib/colors.ts` | Number/currency formatting (incl. compact axis units), chart tick math, chart palette. |
| `lib/site-config.ts`, `lib/site-config-cache.ts` | Operator identity (Impressum data) loading + localStorage cache. |

`components/` mirrors the feature structure: `assets/`, `dashboard/`,
`charts/`, `analysis/`, `allocation/`, `dividends/`, `simulation/`,
`rebalancing/`, `xray/`, `settings/`, `shared/`, `legal/`, `offline/`,
`pwa/`, and `ui/` for shared primitives (modal, confirm dialog, select menu,
skeleton, estimated badge, focus trap, slider, info tooltip).

`app/api/` endpoints at a glance:

| Endpoint | Purpose |
| --- | --- |
| `/api/catalog` | Serves the instrument catalog (world-readable). |
| `/api/quotes`, `/api/price` | Current prices (bulk / one-shot). |
| `/api/history` | Real historical price series + historical FX series. |
| `/api/fx` | Current exchange rates (Frankfurter). |
| `/api/lookup` | Instrument metadata by ISIN/symbol for auto-import. |
| `/api/dividends` | Real dividend events (Yahoo). |
| `/api/benchmarks` | Benchmark index history. |
| `/api/fund/*`, `/api/classify`, `/api/constituents/ensure` | ETF sector/region/country breakdowns and classifications. |
| `/api/share`, `/api/share/[id]` | Create/read shared portfolios (server-only insert, size + rate limits). |
| `/api/account/delete` | Account deletion (token-verified, password re-auth). |
| `/api/errors` | Client error report intake (anonymized, rate-limited). |
| `/api/admin/*` | Admin mutations (flags, site config, price revalidation, error purge), all audit-logged. |
| `/api/cron/sync` and `/api/cron/sync/*` | Scheduled refresh jobs (section 8.4). |
| `/api/migrations` | Applied-migrations listing for `/system`. |

---

## 6. The architecture: seven load-bearing decisions

These are the invariants everything else hangs on. Breaking one of these is
almost always a mistake; each exists for a documented reason.

### 6.1 One storage interface, two implementations (the "store seam")

Because every feature must work with browser storage (Guest Mode) *and* with
Postgres (Registered Mode), all persistence goes through a single interface:
`DataStore` in `lib/store/types.ts`. It defines about twenty operations
(`load`, `addAsset`, `addTransaction`, `updateWatchlistItem`, ...) and is
implemented twice:

- `LocalStore` (`lib/store/local-store.ts`) reads/writes one JSON blob in
  `localStorage`.
- `SupabaseStore` (`lib/store/supabase-store.ts`) reads/writes Postgres rows
  through Supabase, protected by Row Level Security.

`createStore(supabase, userId)` in `lib/store/index.ts` picks the right one
from the login state. **The rest of the app never asks "am I in guest mode?"**
It calls the store. This is the single most important invariant in the
codebase: if you add any persisted data, you extend the `DataStore` interface
and implement it in *both* stores (plus the offline layer below), and nothing
outside `lib/store/` may branch on the mode.

A third implementation wraps the second: `OfflineStore`
(`lib/store/offline-store.ts`) mirrors data locally, queues mutations made
while offline (`mutation-queue.ts`), and `lib/offline/sync.ts` replays the
queue in order on reconnect with a last-write-wins merge (a delete made on
another device beats a stale queued edit). The design is written up in
`OFFLINE_DESIGN.md`; it was built in three phases (read-only shell, mutation
queue, reconnect sync) in early July 2026.

Guest Mode has one hard physical limit: `localStorage` quota. `LocalStore`
throws a tagged `StorageFullError` (`lib/store/errors.ts`) when full, and
every mutation surface in the UI catches it and shows a localized "storage
full" message instead of crashing.

### 6.2 The provider chain: how data reaches the screen

React distributes shared state through "providers" (components that make
values available to everything nested inside them). FinTrack stacks them in a
fixed order in `components/providers.tsx`:

```
AuthProvider            who is signed in? (Supabase session)
  CatalogProvider       the instrument catalog, loaded from the DB
    PortfolioProvider   the user's data, loaded via the store seam
      LivePricesProvider  polls live quotes + FX rates
        ... the actual pages ...
```

Components read these with hooks: `useAuth()`, `useCatalog()`,
`usePortfolio()`, `useLivePrices()`, plus `useFeatureFlag()`, `useI18n()`,
`useTags()` and so on. `PortfolioProvider` recreates the store whenever the
signed-in user changes, so signing in/out swaps Guest and Registered data
cleanly. If loading fails it shows an error card with a Retry button rather
than an endless skeleton (a lesson from a production incident, see 11.7).

### 6.3 Holdings are derived, never stored (the pure finance core)

`lib/finance/` is deliberately **pure**: plain TypeScript functions with no
React, no network, no storage, no imports from `lib/server/`. Given the
transaction list and a valuation context, they compute everything:

- `portfolio.ts`: positions, average-cost basis, realized/unrealized P&L,
  the net-worth time series, per-window profit.
- `returns.ts`, `irr.ts`: time-weighted return series and money-weighted XIRR
  (Newton's method with bisection fallback).
- `stats.ts`: measured expected return and volatility from the user's own
  history (feeding simulation defaults; assumptions are measured, not
  invented).
- `monte-carlo.ts`: the simulation itself, run off the main thread in a Web
  Worker (`monte-carlo.worker.ts`) so the UI never freezes.
- `dividends.ts`, `allocation.ts`, `xray.ts`, `trades.ts`,
  `savings-plans.ts`, `dates.ts`.

Purity is what makes the finance math easy to test (most of `tests/` targets
this layer) and reusable in both modes. Two consequences worth knowing:

- Money amounts always flow through a `ValuationContext` (base currency, live
  prices, current FX, historical FX series) so multi-currency portfolios are
  valued consistently.
- One helper (`rateAtCarryForward`) exists in duplicate, once in the finance
  core and once in `lib/server/fx-history.ts`, *on purpose*: the finance core
  must keep zero server imports.

### 6.4 The instrument catalog lives in the database, not in code

Known instruments (names, ISINs, quote symbols, country, dividend yield,
crypto CoinGecko ids), and the constituent lists of ETFs, are **rows in
Postgres** (`instruments`, `instrument_constituents`), seeded via SQL and
served world-readable by `/api/catalog`. The client caches them in memory
(`lib/catalog/catalog.ts`). Adding a new known instrument means adding a DB
row (migration + `schema.sql` seed), never a hardcoded list in TypeScript. A
hardcoded registry existed early on and was deliberately removed; do not
reintroduce one.

Without Supabase configured, the catalog is empty: auto-import and live
quotes are unavailable, but equities still price and chart by ISIN (resolved
live server-side) and the synthetic fallback covers the rest.

### 6.5 Feature flags live in the database, not in environment variables

`feature_flags` holds one global on/off row per feature; `user_feature_flags`
holds per-user overrides that win over the global. Components gate with
`useFeatureFlag("dividends")` etc. Missing row or no Supabase means
**enabled**. Flags started out as environment variables (July 2), moved to the
DB the same day, and env-var flags plus the Vercel Flags SDK were explicitly
rejected: the owner wants to toggle features per user from SQL or the admin
UI without redeploying. Current flags include `dividends`, `watchlist`,
`savingsPlans`, `taxReport`, `estimated-badge`, `historyCache`, `exportCsv`,
`exportJson`, `errorLogging`.

### 6.6 Market data is fetched server-side; synthetic data is labeled

The browser never talks to Yahoo, Stooq, CoinGecko or Frankfurter directly.
All market data flows through the app's own `/api/*` routes (section 8). This
is a privacy feature the privacy policy explicitly promises ("market-data
calls are server-side, third parties never see your IP or holdings"), and it
is enforced technically by the Content Security Policy in `next.config.ts`
(`connect-src` allows only the app itself and Supabase).

When real data cannot be had, `lib/finance/prices.ts` generates a
deterministic synthetic series (a seeded random walk keyed by the
instrument's identifier) so the UI stays functional, and every surface that
might show synthetic data renders `EstimatedBadge` (`components/ui/`). The
badge chain (`synthetic`/`containsSynthetic` flags on series,
`syntheticPrice` on holding summaries) must be preserved when adding new
chart or price surfaces.

### 6.7 Everything client-rendered, one bilingual dictionary

Nearly every component starts with `"use client"`. There is no server-side
UI data layer, by design: Guest Mode data physically exists only in the
browser, and charts and the simulation worker are browser-only anyway.

All user-facing text goes through the i18n layer: `t("dashboard.netWorth")`
looks a key up in `lib/i18n/dictionaries.ts`, which holds the English and
German dictionaries side by side (they must always have identical key sets).
Two absolute rules for German copy: the **informal "du" register** everywhere
(a user decision that overrode an earlier formal-"Sie" convention), and **no
em-dashes** in user-facing copy. `<html lang>` follows the active locale.

---

## 7. The database

The full schema is in `supabase/schema.sql` (a single idempotent script for
fresh installs); `supabase/migrations/0001...0052+.sql` evolve an existing
database and record themselves in `schema_migrations`. **Golden rule: any
data-model change updates both, in the same commit, and every statement must
be idempotent** (safe to run twice: `create table if not exists`,
`drop policy if exists` before `create policy`, guarded backfills).

The tables, grouped by purpose:

**Per-user data** (all with Row Level Security, so users only see their own
rows):

| Table | Purpose |
| --- | --- |
| `profiles` | Base currency, display name, preferred locale. |
| `portfolios` | Named portfolios (a user can have up to 20). |
| `assets` | The user's asset master rows (ISIN/WKN/symbol, name, type, native currency, notes). |
| `transactions` | The transaction log: type, quantity, price, fee, tax, timestamp (`executed_at`), portfolio. The heart of the data model. |
| `watchlist_items` | Instruments followed without owning them, incl. an optional per-item currency override. |
| `savings_plans` | Recurring buy rules (amount, `frequency`, start date, active, `lastRunDate`). The column is called `frequency` because `interval` is a reserved word in Postgres. |
| `imported_rows` | Fingerprints of CSV rows already imported, each tied to the transaction it created, so deleting the transaction cascades the fingerprint and re-imports surface correctly. |
| `simulation_runs` | Cached Monte Carlo results keyed by a parameter hash (pruned after 90 days). |
| `user_feature_flags` | Per-user feature overrides. |

**Shared reference data** (world-readable, written only by cron jobs or the
operator):

| Table | Purpose |
| --- | --- |
| `instruments` | The instrument catalog: identifiers, resolved Yahoo quote symbol (`quote_id`), last cron-synced price (`last_price`), `quote_scale` (unit multiplier, e.g. gold ounce to gram), country, dividend yield, name-sync marker. |
| `instrument_constituents` | Which stocks an ETF contains, with weights (feeds X-Ray). |
| `etf_breakdowns` | ETF sector/region/country weightings. |
| `benchmark_history` | Cached index histories, stored per currency, converted on read. |
| `instrument_history` | Cached real price series per instrument and range (24h/7d staleness; pruned after 60 days without a read refresh). |
| `fx_rates` | Cached exchange rates. |
| `feature_flags` | Global feature switches. |
| `site_config` | Operator identity for the legal pages (name, address, contact), editable in the admin UI. |
| `app_settings` | Operational settings such as `max_users` (a registration cap). |

**Operational tables:**

| Table | Purpose |
| --- | --- |
| `schema_migrations` | Which migrations have been applied (shown on `/system`). |
| `shared_portfolios` | Share-link payloads (server-only inserts, 256 KB cap, optional expiry, cleaned up by cron). |
| `rate_limit_counters` | DB-backed per-IP rate limiting for the market-data APIs (fails open when Supabase is absent so Guest Mode is unaffected). |
| `admins` | Who may use the admin backend; checked server-side and via the `is_admin()` SQL function referenced in RLS policies. |
| `admin_audit` | Every admin mutation: actor, action, target, old/new values. |
| `error_logs` | Self-hosted client error reports (no user id, no IP, truncated stacks; purged after 30 days). |

There is also `supabase/demo_user.sql`: a demo portfolio that resets itself
nightly via `pg_cron`.

---

## 8. The market-data pipeline

This is the most operationally delicate part of the app, because it is built
entirely on **free, unofficial data sources**.

### 8.1 The sources

| Source | Used for | Notes |
| --- | --- | --- |
| **Yahoo Finance** | Equity/ETF quotes, history, dividends, ETF data, search | Unofficial and keyless; can rate-limit (HTTP 429) at any time. |
| **Stooq** | Equity quote fallback | |
| **CoinGecko** | Crypto prices | Needs the catalog row for the CoinGecko id. |
| **Frankfurter** | Current and historical FX rates | Public ECB-based API. |
| **onvista** | ETF country/sector data, WKN lookup fan-out | German site, keyless. |
| **Financial Modeling Prep** | Extra ETF constituents | Optional, needs `FMP_API_KEY`. |
| **SlickCharts** | S&P 500 / Nasdaq-100 / Dow constituents | |

### 8.2 Resolution: from ISIN to the right listing

One ISIN trades on many exchanges in many currencies (the ETF "VWCE" has a
EUR line on Xetra and a USD line in London). Pricing the wrong line corrupts
every chart. So resolution (in `lib/server/yahoo.ts` / `search.ts`) always
prefers **the listing whose currency matches the asset's native currency**,
and among those, the exchange with deep data. The resolved listing (the
"hint", stored as `instruments.quote_id`) then becomes authoritative for
prices *and* dividends. German WKNs are not resolvable by the free sources;
a parallel Yahoo + onvista fan-out handles what it can, and the rest falls
back to manual entry.

All Yahoo traffic funnels through the `getJSON` helper in
`lib/server/yahoo.ts`, which carries a concurrency semaphore, 429/503 backoff
with a cooldown breaker, and TTL caches. **Never fetch Yahoo endpoints from
anywhere else.**

### 8.3 The layered price model

For any instrument, the price shown is the best of, in order:

1. **Live price** from the cron-maintained `instruments.last_price`
   (STOCK/ETF), surfaced by `LivePricesProvider`; or a one-shot `/api/price`
   fetch where appropriate (watchlist currency overrides, stale transaction
   form prefills older than one hour).
2. **Real history** from `/api/history` (cached in `instrument_history`
   server-side and in a browser-local stale-while-revalidate cache,
   `lib/history/history-cache.ts`, behind the `historyCache` flag).
3. **Synthetic series** (`lib/finance/prices.ts`) as the last resort, always
   badge-labeled, and **anchored to the asset's own trade prices** so a fake
   walk can never dwarf reality (see war story 11.4). When a live price
   exists, the synthetic series is rescaled to end at it so charts stay
   continuous.

Unit conversion: some quotes come in different units than the holding (Yahoo
prices gold per troy ounce; users hold grams). `instruments.quote_scale` is a
per-instrument multiplier applied after FX conversion, and only ever to
resolved market prices, never to stored transaction prices or synthetic
series (`lib/server/scale.ts`).

Currency conversion: each asset has a native currency; everything is
displayed in the user's base currency. Current rates come from `/api/fx`;
**historical** rates ride along in the `/api/history` response (one
Frankfurter time series per needed currency, `lib/server/fx-history.ts`), so
a USD holding's multi-year EUR chart reflects actual FX drift instead of
applying today's rate to the past (fixed 2026-07-11, see 11.6). Snapshot
numbers (current position value, cost basis) deliberately stay on the spot
rate.

### 8.4 The cron jobs

Reference data stays fresh through POST endpoints under `app/api/cron/`,
protected by `CRON_SECRET` at the middleware edge and triggered by an
external scheduler (Vercel Cron or similar; schedules in `OPERATIONS.md`):

| Endpoint | Job |
| --- | --- |
| `/api/cron/sync` | Orchestrator: runs all of the below in one call, forwarding its query string. |
| `.../sync/prices` | Refreshes `instruments.last_price`. STOCK/ETF rows self-heal (once a day, or with `?revalidate=1`, the stored listing hint is dropped and re-resolved from scratch, which fixes stuck mis-resolutions). COMMODITY rows are the opposite: their stored `quote_id` is authoritative and never re-resolved via search (see 11.1). |
| `.../sync/names` | Re-syncs official instrument names into the catalog (CASH/COMMODITY excluded, same-type-only guard). |
| `.../sync/constituents`, `.../sync/etf-breakdowns`, `.../sync/classifications` | ETF composition, sector/region/country weightings, instrument classifications. |
| `.../sync/benchmarks` | Benchmark index history. |
| `.../sync/shared-portfolios` | Deletes expired share links. |
| `.../sync/error-logs` | Purges error logs older than 30 days. |
| `.../sync/retention` | Prunes `simulation_runs` (90d) and stale `instrument_history` (60d). |

### 8.5 Defenses

- **Rate limiting**: the public market-data proxy routes are DB-rate-limited
  per IP (`lib/server/rate-limit.ts`); limits fail open without Supabase.
- **CSP**: production responses carry a strict Content Security Policy; any
  new client-side fetch to an external origin must either be added there or,
  better, proxied through an API route.
- **API_TOKEN**: optional bearer gate over all non-cron API routes.
- **Share hardening**: `shared_portfolios` inserts are server-only (the
  anonymous insert policy was dropped), size-capped and rate-limited.

---

## 9. Business logic: the domain rules

### 9.1 Transaction types and cash math

`TransactionType` is `BUY | SELL | BOOKING | INTEREST` (`lib/types.ts`):

- **BUY / SELL**: ordinary trades. Quantity is always positive; direction
  comes from the type.
- **BOOKING** (German "Einbuchung"): shares credited at **zero cost**, e.g.
  an employer's vermögenswirksame Leistungen or a gift. Their full current
  value counts as profit.
- **INTEREST**: interest credited to a cash position, also zero cost basis,
  counted as return.

Every transaction carries `fee` **and `tax`**, and tax mirrors fee in all
cash math: a buy tax raises the cost basis, a sell tax reduces the proceeds.
`lib/finance/trades.ts` builds the per-calendar-year tax report from this.

CASH positions get special UI treatment: their "price" is meaningless, so
tables and charts show total value, no course chart, no dividends, no
estimated badge.

### 9.2 Cost basis and profit

Average-cost method: buying more shares blends into one average purchase
price; selling realizes profit against that average. Period profit
percentages divide by the **capital actually exposed in the window**
(start-of-window value plus in-window buy inflows), never by the start value
alone; dividing by a tiny day-one position once produced an absurd +953%
(see 11.3).

Holding reconstruction compares transactions by **day**, and all dates in the
app are timezone-stable `YYYY-MM-DD` strings manipulated via
`lib/finance/dates.ts`, never raw JavaScript `Date` arithmetic (which shifts
across timezones).

### 9.3 Returns

Two complementary measures, both shown:

- **TWR** (`twrSeries`) for charts and benchmark comparison; deposits and
  withdrawals never distort it.
- **XIRR** (`lib/finance/irr.ts`) as the personal money-weighted rate.

Benchmarks use total-return index variants where possible for fair
comparison, with an approximation hint in the UI.

### 9.4 Dividends: real events only, the hinted listing is law

Dividends come from **real payout events** (Yahoo, via `/api/dividends`)
scaled by the shares held on each pay date. Accumulating ETFs therefore
correctly show none. The listing that prices the asset (the hint) is
**authoritative in `dividendsByQuery`**: if it resolves, its event list is
used *even when empty*. Never scan further search candidates past a resolved
hint, and never gate dividends by asset type or a feature flag; both
approaches were tried and explicitly rejected after the phantom
gold-dividends incident (11.2). The guiding memory rule: *fix the data
source; never gate financial facts by category.*

### 9.5 Savings plans

Savings plans (`lib/finance/savings-plans.ts`) never touch the finance core.
A pure function derives which occurrences are due; the dashboard card then
books them as **ordinary BUY transactions only after an explicit user review
dialog**, advancing `lastRunDate`. This keeps the transaction log the single
source of truth.

### 9.6 Watchlist and the "first transaction creates the holding" flow

Watchlist items share the asset's identity shape but carry no transactions.
Clicking one opens `/instruments/[key]`, which renders the **full** asset
detail layout with zero-state metrics; the embedded transaction form's
`ensureAsset` seam resolves-or-creates the real asset on first submit
(deduplicated by price key, sentinel ids `wl:`/`cat:` never reach storage)
and the page flips to the held view. Watchlist rows price via
`pickWatchlistPrice` (`lib/live/watchlist-price.ts`): the cron-cached catalog
price is used only when it agrees with the item's currency override,
otherwise a one-shot `/api/price` fetch in the chosen currency wins.

### 9.7 CSV import and export

`lib/import/csv.ts` parses broker exports: precise parsers for known German
brokers (including ZERO, Deutsche Bank, FNZ quirks) and Bitpanda (whose
header hides behind a personal-data preamble; crypto maps to CRYPTO, metals
to COMMODITY with gold as `XAU` in grams, fiat rows are skipped), plus a
header-driven generic parser for everything else. Imported names are replaced
by official instrument names via catalog/lookup.

`lib/import/reconcile.ts` fuzzy-matches parsed rows against existing
transactions: identical matches are filed away silently, real conflicts go
through a three-pane field-level merge dialog. Applied rows record a
fingerprint tied to the created transaction, so deleting that transaction
(directly or via cascading deletes) frees the fingerprint and a re-import
offers the row again.

The app's own export (`lib/export/export.ts`) writes a CSV with a
`# FinTrack export` marker line; the importer recognizes it as its own
`fintrack` format, making export/import a lossless round trip (no lock-in).
Export surfaces are gated by the `exportCsv`/`exportJson` flags.

Real broker CSVs at the repository root are **gitignored** because they
contain personal data; tests use inline anonymized fixtures.

### 9.8 Tags

Tags are grouped key-value pairs (e.g. group "Strategie", value "gamble"),
managed by `TagsProvider` (`lib/tags/tags-context.tsx`) and persisted
**localStorage-only** under `fintrack-tags` (a deliberate exception to the
store seam, disclosed in the privacy policy). The Analysis "Custom" breakdown
can switch per group; holdings without a value fall into a gray "Untagged"
bucket.

### 9.9 Sharing

A user can publish a read-only snapshot (or live-updating view) of a chosen
portfolio. Creating a link voids the user's previous links; links can expire;
"incognito" hides absolute amounts. Inserts happen only server-side through
`/api/share` with payload caps and rate limits.

### 9.10 Admin backend

`/admin` (July 11) is gated three ways: server routes verify the caller's
token *and* membership in the `admins` table (`lib/server/require-admin.ts`),
RLS policies use the `is_admin()` SQL function, and the client-side gating is
UX-only. Every admin write goes through `/api/admin/*` with the service-role
key and leaves an `admin_audit` row. Admins are seeded by a one-line SQL
insert; there is deliberately no admin-management UI, SSO, or role hierarchy.

Error logging is self-hosted for privacy (Sentry was rejected because the
privacy policy promises "no analytics"): browser errors flow through
`lib/errors/report.ts` (throttled, deduplicated, no user id, no IP, truncated
stacks, no-op when the `errorLogging` flag is off) into `error_logs`, viewable
at `/admin/errors`, purged after 30 days.

### 9.11 Authentication rules

Sign-in never enforces a minimum password length (existing short passwords
must keep working); signup and password change enforce 8 characters. The
login form deliberately has no required-field gating (user decision). After
3 consecutive failed sign-ins the submit button locks behind an exponential
backoff countdown. Account deletion requires typing "delete" plus the current
password. A registration cap (`app_settings.max_users`) can close signups.

---

## 10. Cookbook: "I want to change X"

| You want to... | Go to... | Watch out for... |
| --- | --- | --- |
| Change any visible text/label | `lib/i18n/dictionaries.ts` | Change EN and DE together; key sets must stay identical. German: informal "du", no em-dashes. |
| Change German wording style | same file | The du-register rule is absolute (overrides older Sie copy). |
| Change a page's layout | Find the route in section 2's table, then edit the component it points to | Pages are thin; the real markup is in `components/`. |
| Change the holdings table (columns, sorting) | `components/assets/asset-table.tsx` | |
| Change the net-worth chart or its controls | `components/dashboard/net-worth-hero.tsx`, `components/charts/performance-chart.tsx`, `chart-controls.tsx` | Log scale only applies in currency mode. Never hardcode a y-axis width; use `yAxisWidth`/`axisCurrencyFormatter` from `components/charts/axis.ts`. |
| Change the add-transaction form | `components/assets/transaction-form.tsx` | Keep the required-fields gating pattern (`lib/forms/required.ts`) and the `StorageFullError` handling. |
| Change how profit/cost basis/net worth is computed | `lib/finance/portfolio.ts` (+ `tests/portfolio.test.ts`, `tests/finance.test.ts`) | Pure functions only; add tests with exact-value assertions. |
| Change IRR, TWR, risk stats, simulation math | `lib/finance/irr.ts`, `returns.ts`, `stats.ts`, `monte-carlo.ts` | Simulation runs in a Web Worker; keep it pure. |
| Add a new asset type | `lib/types.ts` (`AssetType` union) | The compiler will list every `Record<AssetType, ...>` site to update (stats, allocation buckets, labels). |
| Add a known instrument to the catalog | New migration + same rows in `supabase/schema.sql` seed | Never a hardcoded TypeScript list. |
| Add or change a feature flag | Migration + `schema.sql` seed row, `FeatureFlag` union in `lib/flags/flags-context.tsx`, gate with `useFeatureFlag` | Never an env var. Missing row = enabled. |
| Change the database | New file in `supabase/migrations/` **and** `supabase/schema.sql` | Idempotent statements only; register in the `schema_migrations` seed. |
| Support a new broker's CSV | `lib/import/csv.ts` + `tests/import.test.ts` | Use inline anonymized fixtures; real CSVs are gitignored PII. |
| Change price fetching/resolution | `lib/server/yahoo.ts`, `lib/server/search.ts`, `app/api/quotes|price|history/route.ts`, price cron | All Yahoo traffic must go through `getJSON` in `yahoo.ts`. Respect the COMMODITY hint rule (11.1). |
| Change dividend behavior | `lib/finance/dividends.ts`, `app/api/dividends/route.ts` | Hinted listing is authoritative; no type/flag gating (11.2). |
| Change live-price polling | `lib/live/live-prices-context.tsx` | |
| Style something | Tailwind `className` strings in the component | Verify both EN and DE (German strings are longer) and light + dark. |
| Add a chart | `components/charts/` for shared pieces | Keep the `EstimatedBadge` chain and `role="img"` + localized `aria-label`. |
| Change legal pages / privacy policy | `app/impressum|datenschutz|terms/page.tsx`, `components/legal/legal-page.tsx` | The policy makes verifiable claims about the code; keep it truthful when data flows change. The contact email renders via canvas; never as text/mailto/ARIA. |
| Change security headers / CSP | `next.config.ts` | New external client-side origins must be added or (better) proxied. |
| Change rate limits | `lib/server/rate-limit.ts` + the limit numbers at each route call site | Fails open without Supabase, on purpose. |
| Change cron behavior / retention windows | `app/api/cron/sync/*/route.ts` | POST-only, `CRON_SECRET` enforced in `middleware.ts`. |
| Change admin pages | `app/admin/*`, `lib/admin/`, `app/api/admin/*` | Server-side `require-admin` on every route; audit every write. |
| Change offline/PWA behavior | `public/sw.js`, `lib/offline/`, `lib/store/offline-store.ts`, `OFFLINE_DESIGN.md` | Never hand-bump the SW version; the prebuild script stamps it. |
| Change auth/login behavior | `app/login/page.tsx`, `lib/auth/auth-context.tsx` | Password floor 8 on signup/change only; never on sign-in. |
| Add persisted user data | `lib/types.ts`, `lib/store/types.ts`, then **all three** stores + `lib/offline/sync.ts` replay + migration + schema | The store seam is sacred; UI never branches on mode. |

---

## 11. History and war stories: why certain rules exist

The repository's rules read as dogma until you know the incidents behind
them. These are reconstructed from commit messages and `LEDGER.md`.

### 11.1 Gold at 1.42 EUR (the COMMODITY hint rule)

Gold (symbol `XAU`) was added as the first COMMODITY asset on July 9
(Bitpanda import support). Yahoo's search, given a bare metal ticker,
mis-resolves it: `XAU` matched an Italian listing `XAUS.MI` whose scaled
price wrote **1.42 EUR per gram** into the catalog, and the price cron
re-wrote the wrong value on every run. Fixes: `quote_scale` for
ounce-to-gram conversion, a repair migration (`0044`), and the standing rule
that **a COMMODITY row's stored quote hint is authoritative**: the cron never
re-resolves it via search and skips the row if the hint doesn't resolve to
itself. STOCK/ETF rows got the opposite medicine (a daily self-heal that
drops the hint and re-resolves) because their failure mode is a *stuck* wrong
listing, as happened with GameStop (GME).

### 11.2 Phantom gold dividends (real data, no category rules)

Gold then showed dividend payouts. Root cause: the dividends lookup resolved
the hinted listing, found (correctly) zero events, but **kept scanning**
search candidates and imported an unrelated payer's events via a name match
on "Gold". Two fixes were tried and rejected by the user: excluding
COMMODITY assets from dividend fetching (a type rule), then a per-instrument
`pays_dividends` flag in the catalog (still a category rule, just in SQL).
Both were reverted. The accepted fix: **trust the hinted listing's real
event list, empty or not**. This hardened into a project-wide principle: fix
the data source; never gate financial facts by asset type or flags.

### 11.3 The +953% holding

The max-timeframe profit percentage once divided the window's profit by the
value at the window start. At "max", the window starts at the first
transaction, which can be a tiny day-one buy, so a normal portfolio showed
+953%. Since July 10, period profit divides by capital exposed over the
window (start value plus in-window buy inflows).

### 11.4 The 25,000 EUR net-worth spike (synthetic anchoring)

The dashboard's max-timeframe chart showed a one-day ~25k spike on
2025-05-28. Diagnosis went through several wrong hypotheses (data shape,
chart granularity, FX) before the real cause surfaced: the user had traded
German **knock-out warrants**, which no free source can price, so the chart
valued them with the synthetic random walk whose starting price is a
hash-derived value between 20 and 480 EUR. 200 warrants actually bought at
0.35 EUR were charted at a synthetic ~125 EUR: a fake ~25,000 EUR position
for exactly the one day it was held. The fix (July 11): synthetic series are
now **anchored to the asset's own most recent trade price** (precedence:
live price, then trade anchor, then the hash fallback), so synthetic values
can never be orders of magnitude away from what the user actually paid.

### 11.5 The stuck skeleton

A deploy added a column read (`watchlist_items.currency`) before the user
applied the migration; the portfolio load rejected, nothing caught it, and
registered users saw an endless loading skeleton. Beyond the immediate
lesson (apply migrations with deploys), the durable fix is that load
failures now render an error card with a Retry button, never a silent hang.

### 11.6 Historical FX drift

Multi-year charts of foreign-currency holdings used to convert every
historical point at **today's** exchange rate, which misstates history
whenever FX drifted. Since July 11, `/api/history` returns historical FX
series alongside prices and the chart math looks up the rate per point date
(carry-forward for gaps). Snapshot metrics deliberately stay on spot.

### 11.7 Assorted decisions with reasons

- **Feature flags in the DB** (July 2): env-var flags and the Vercel Flags
  SDK were explicitly rejected; the owner toggles features per user without
  redeploying.
- **Formal "Sie" to informal "du"** (July 10): the German copy originally
  standardized on formal address, then the user overruled it; all German
  copy, including legal and error pages, now uses "du".
- **Email as canvas image** (July 10): the legal-contact email is drawn onto
  a canvas so scrapers never see it in the DOM; never reintroduce it as
  text, `mailto:`, or an ARIA attribute.
- **Self-hosted error logging instead of Sentry** (July 11): the privacy
  policy's "no analytics" claim is a product feature; an in-house,
  anonymized `error_logs` table serves both needs.
- **Heavy computation stays client-side** (July 10 caching decision): the
  finance math is sub-millisecond; the visible wait was network. Hence
  caching efforts target network responses (DB-cached histories, browser
  stale-while-revalidate cache), not computed results.
- **Vercel test failure** (July 11): Vercel builds run with
  `NODE_ENV=production`, which made React's test utilities disappear and
  failed the build's test step; `vitest.config.ts` now forces
  `NODE_ENV=test`.
- **Registration cap** (July 2) and a **nightly self-resetting demo
  portfolio** via `pg_cron` (June 29) exist for controlled public exposure.

---

## 12. Project timeline

Compressed from ~280 commits. The project went from `create-next-app` to a
production-deployed, bilingual, offline-capable app in 16 days.

| Date (2026) | Milestones |
| --- | --- |
| Jun 26 | Project created; login/register; first asset & analysis pages. |
| Jun 27 | Monte Carlo simulation; ETF X-Ray; PWA (manifest, service worker); cron sync with secret; Vitest suite gating the build; migration tracking + `/system`; real Yahoo dividends; benchmark comparison overlay; confirm dialogs for destructive actions. |
| Jun 28 | i18n framework (EN/DE); shareable portfolio links (incl. incognito + live mode); multiple portfolios; tagging; rebalancing module; country look-through; TWR return charts; risk tab groundwork; user profiles. |
| Jun 29 | Risk tab redesign; demo user with nightly reset; add-asset modal; mobile fixes. |
| Jul 1-2 | Simulation persistence + seedable PRNG + withdrawal phase; registration cap; broker CSV import with fuzzy merge; wide sidebar layout; feature flags (env, then DB the same day); import fingerprints tied to transactions; BOOKING type; risk metric corrections. |
| Jul 3-4 | INTEREST type; WKN lookup fan-out; account deletion; offline phases 1-3 (shell, queue, sync); legal pages + consent + disclaimers; CSP + security headers; Yahoo throttle/backoff; synthetic-data badges; share hardening; a11y (focus traps, chart labels); `site_config`; share expiry. |
| Jul 5 | Mobile density; cash-position UX; estimated-badge flag; offline auto-recovery. |
| Jul 6-7 | Roadmap "Now" wave: tax field + tax report, watchlist, savings plans, dividend dashboard; required-field form pattern; skeleton loading; offline shell fix. |
| Jul 9-10 | COMMODITY asset type + `quote_scale` + gold; Bitpanda import; watchlist currency overrides + instrument detail route; official-names cron; security bundle (rate limits, login backoff, strict cron gate); history caching layers; FK indexes; canvas email; grouped tags; export flags + round-trip import; du-register sweep; dividends hint-authoritative rule (after two reverted attempts). |
| Jul 11 | Historical FX correctness; storage-full handling; login/settings i18n + password floor 8; README rewrite; synthetic price anchoring (the 25k spike); admin backend (authz, flags, site, prices, errors, audit); transaction-form layout; unified instrument detail ("first transaction creates the holding"); retention crons; SW build versioning; OPERATIONS runbook. |

The development process itself is documented in `LEDGER.md`: work happened
in numbered "rounds", each with an audit of open items, per-task design
notes, and verification records (tests, lint, build, browser walkthroughs in
both locales).

---

## 13. Working on the code: setup, tests, conventions

### Setup

```bash
npm install
cp .env.example .env.local   # optional; empty = Guest Mode only
npm run dev
```

For Registered Mode, create a Supabase project and run
`supabase/schema.sql` against it (fresh install), or apply
`supabase/migrations/*.sql` in order to evolve an existing database. Then
point a scheduler at the cron endpoints (section 8.4). Operational
procedures (deploys, rollbacks, key rotation, backups, incident triage) are
in `OPERATIONS.md`.

### Testing

Tests live in `tests/` and run with `npx vitest run`; `npm run build` runs
them first, so the production build fails on a red test. Coverage focuses on
pure logic: the finance core, both store implementations, CSV
import/reconciliation, formatting, server helpers. UI-heavy behavior is
verified in-browser (both locales) because unit tests over pure functions
miss wiring bugs; that lesson is recorded in the project memory.

### Conventions checklist (the short version of CLAUDE.md)

- Persisted data changes go through the store seam and both SQL files,
  idempotently.
- Finance core stays pure (no React, no network, no `lib/server` imports).
- Every user-facing string exists in EN and DE; German uses "du"; no
  em-dashes in user-facing copy.
- Dates are `YYYY-MM-DD` strings via `lib/finance/dates.ts`.
- No synchronous `setState` inside effects (build-failing lint rule).
- Destructive actions always get a `ConfirmDialog`.
- New mutation call sites handle `StorageFullError`.
- Synthetic data keeps the `EstimatedBadge` chain intact.
- Yahoo only via `lib/server/yahoo.ts`; new external client fetches need CSP
  changes or a proxy route.
- Chart y-axes use the shared width/formatter helpers; one compact unit per
  axis.
- Forms disable submit on missing required fields only; content validation
  happens at submit time.

---

## 14. Map of the other documents in this repository

| File | What it is |
| --- | --- |
| `README.md` | Quick start: setup, env vars, Supabase, architecture summary. |
| `CLAUDE.md` | The living conventions/invariants file for AI-assisted development; the densest source of current rules. |
| `DOCUMENTATION.md` | This handbook. |
| `OPERATIONS.md` | Ops runbook: deploy/rollback, migrations, cron schedules with curl examples, backups, key rotation, incident triage. |
| `LEDGER.md` | The round-by-round development ledger: audits, task designs, decisions, verification records. The best source for "why is it like this?". |
| `PRD.md` | The original product requirements document the project started from. |
| `ROADMAP.md` | Competitive analysis (Portfolio Performance, Finanzfluss Copilot, Parqet, getquin) and the build-next list. |
| `OFFLINE_DESIGN.md` | Design of the offline/PWA architecture (three phases, LWW merge). |
| `SEARCH_DESIGN.md` | Design of the instrument search/lookup fan-out. |
| `PROD_READY.md` | The production-readiness punch list (largely worked off; kept as a record). |
| `TODO.md` | The owner's working notes; feeds each development round. |
| `supabase/schema.sql` / `supabase/migrations/` | The canonical database definition and its evolution. |
