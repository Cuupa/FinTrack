# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev       # start dev server (http://localhost:3000)
npm run build     # production build
npm run start     # serve production build
npm run lint      # ESLint
npm run test      # vitest unit suite (pure finance/i18n core)
npm run test:e2e  # Playwright browser tests (Guest Mode wiring); see E2E.md
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

**Plan gating (MONETIZATION.md Phase 2, dark-launched)**: `feature_flags`
also carries `required_plan` ('free'|'pro', default 'free' — every flag is
seeded free; the owner re-tiers rows on /admin/flags at runtime). Resolution
(`lib/flags/resolve.ts`, pure/unit-tested): user override wins outright (and
doubles as a Pro grant) > kill switch (`enabled=false` = invisible) >
pro-required + free plan = `{enabled, locked}` > on; missing column/row or no
Supabase = free/on, so a DB lagging migration 0065 behaves exactly as before.
`useFeature(flag)` returns `{enabled, locked}`; `useFeatureFlag` stays boolean
(`enabled && !locked`) so call sites that haven't adopted `useFeature` still
just hide a locked feature. The shared `<ProTeaser feature="...">`
(`components/billing/pro-teaser.tsx`, MONETIZATION.md Phase 3) is adopted on
the five surfaces that gate on a Pro flag — the /analysis risk and tax tabs
(tab stays visible), /dividends, /simulation, /xray, /rebalancing. It renders
the real feature UI passed as `children` **blurred + `inert`** underneath a
centered paywall message (lock icon + "Pro feature" copy + upgrade CTA) so the
user sees a preview of what Pro unlocks rather than a blank card; each call
site passes the same view it renders when unlocked (e.g.
`locked ? <ProTeaser feature="dividends"><DividendsView/></ProTeaser> :
<DividendsView/>`), with the loading/error gates kept **before** the lock so a
still-loading page shows its skeleton, not a blurred empty state. Called
without `children` it falls back to the old standalone empty-state card. Its
upgrade button only shows when the `billing` flag is on.
Still dark in prod: every flag is seeded `required_plan='free'`, so nothing
locks (and no teaser renders) until the owner re-tiers a flag on
/admin/flags.
`usePlan()` (`lib/billing/use-plan.ts`) is the billing seam — a thin read of
`BillingProvider` (`lib/billing/billing-context.tsx`, mounted under
`AuthProvider` and above `FeatureFlagsProvider` in `components/providers.tsx`
since flag resolution consumes it), which loads the signed-in user's own
`subscriptions` row and feeds it through `resolvePlan` (`lib/billing/plan.ts`,
active/trialing/past_due+7d grace, pure). Guests / no Supabase / not yet
loaded all resolve `"free"`.
`plan_limits` (free/pro caps per `limit_key` — `watchlistItems`,
`savingsPlans`, `portfolios` — null = unlimited, seeded unlimited) is
enforced (Phase 4) at its three add-surfaces: watchlist add
(`components/dashboard/watchlist-card.tsx`), savings-plan create
(`components/savings/plan-form.tsx`, shared by the dashboard card and the
asset-detail page's "new plan" entry point), and portfolio create
(`components/portfolio-picker.tsx`, the header picker, **plus every inline
"+ New portfolio" `SelectMenu` footer that calls the same `createPortfolio`
mutation** — `add-asset-form.tsx`, `transaction-form.tsx`,
`import-transactions.tsx` — capped identically so none of them bypass the
picker's limit). Pure resolution + the grandfathering
rule live in `lib/billing/limits.ts` (`resolveLimit`/`atLimit`, unit-tested):
`atLimit` only ever blocks ADDING past the cap, never hides or disables a
row already over it after a downgrade. `plan_limits` is loaded once in
`FeatureFlagsProvider` (`lib/flags/flags-context.tsx`) — it already loads
the sibling world-readable `feature_flags` table with the same shape and
already consumes `usePlan()` — and surfaced via `usePlanLimit(key)`; a
capped add-surface always shows an inline localized hint (e.g. "Free plan
includes up to {n} watchlist items", linking to /pricing when the `billing`
flag is on) instead of a silently disabled control. Seeded unlimited in
prod, so nothing changes until the owner sets a cap on /admin/site's "Plan
limits" card (`POST /api/admin/site` `{ kind: "limits" }`, validated by
`lib/server/plan-limits-admin.ts`).
`plan_grants` (migration 0068, "gratitude premium") independently grants a
user Pro until `expires_at` or forever (`null`), regardless of any Stripe
subscription; `BillingProvider` loads the user's own grants (select-own RLS)
alongside their subscription and `resolvePlan` honors an active grant as a
standalone path to `"pro"`. Grants are issued/revoked on `/admin/billing`'s
"Premium grants" card (service-role writes only, every grant/revoke
audited).

**Billing (MONETIZATION.md Phase 1, dark-launched behind the `billing` flag,
seeded disabled)**: Stripe Checkout + Billing portal, redirect-based only —
no Stripe.js on the page, so CSP `connect-src` stays untouched. Price ids +
the selling toggle live in `billing_config` (config-in-DB, world-readable,
owner-written), editable at runtime on `/admin/billing`. `billing_config`
also carries owner-typed **display price strings**
(`price_monthly_display`/`price_yearly_display`, migration 0070, e.g. "4,99
EUR") shown on `/pricing` — free text, never formatted or computed with,
distinct from the Stripe price ids; nullable, so `/pricing` shows the plan
comparison without an amount rather than inventing one while empty. The
Stripe secret
key and webhook secret are DB-first with an env fallback (round 2026-07-19b):
`app_settings.stripe_secret_key`/`stripe_webhook_secret` (RLS enabled, zero
policies — service-role only) win over `STRIPE_SECRET_KEY`/
`STRIPE_WEBHOOK_SECRET` when set, resolved once per request by
`getStripeKeys()` (`lib/server/billing-keys.ts`); every caller that touches a
key goes through it instead of reading `process.env` directly. Also editable
on `/admin/billing`: `GET /api/admin/billing` never echoes a stored secret
(presence booleans only), `POST` sets/clears a key (empty or `null` clears)
or upserts the config, and every write is audited — key writes record only
"set"/"cleared" per field, never the value (`lib/server/billing-admin.ts`,
`app/api/admin/billing/route.ts`). `/api/billing/checkout` and
`/api/billing/portal` (POST, session bearer token) return `{ url }` to
redirect to; `/api/billing/webhook` is the sole writer of `subscriptions`
(service role, select-own RLS for the client).
Settings gets a "Subscription" card (`components/settings/subscription-card.tsx`,
flag-gated, registered-users-only — guests can't subscribe and the
create-an-account teaser funnel is Phase 3) reading `useBilling()` for
`{plan, subscription, loading}` and hitting the checkout/portal routes
directly with the session token, same pattern as account deletion in
`components/settings/settings-view.tsx`. `BillingProvider` re-fetches once,
after a short delay, when the page was entered with `?billing=success`
(Checkout return) since the webhook can lag the redirect. The
checkout/portal redirect call (`lib/billing/checkout-client.ts`) is a shared
helper so the settings card and `/pricing` don't each reimplement it.

**Pricing page + legal (MONETIZATION.md Phase 3, ships with `billing` flag
still off in prod)**: `/pricing` (`app/pricing/page.tsx`) is a Free-vs-Pro
marketing comparison, gated behind the `billing` flag the same way any other
flag-gated route degrades to `FeatureUnavailable`. It reads the display
prices via `useBillingConfig()` (`lib/billing/use-billing-config.ts`, a
direct world-readable-row read through the browser Supabase client, same
shape as `BillingProvider`'s own subscription fetch) with skeleton
placeholders while loading. The CTA reuses `redirectToBilling`: registered
users check out directly, guests get a link to `/login`, an already-Pro user
gets a link to manage instead of a second checkout, and the buy buttons
disappear (comparison-only) when `billing_config.enabled` (the owner's
selling toggle, independent of the `billing` flag) is off.
`<ProTeaser>`'s upgrade link now points to `/pricing` instead of
`/settings#subscription` (MONETIZATION.md: "Locked teasers deep-link here").
`/datenschutz` and `/terms` (EN+DE) carry the Phase-3 legal sections
required before a real checkout is reachable: a Stripe payment-processing
section (`/datenschutz` — email + payment metadata shared with Stripe,
FinTrack itself never stores card data, linked to Stripe's privacy policy)
and a subscription-terms section (`/terms` — billing interval, auto-renewal,
portal cancellation effective at period end, prices as shown at checkout,
the EU 14-day withdrawal right and its early-expiry consent at checkout).
Both are phrased conditionally ("Wenn du ein Abo abschließt, ...") so they
stay accurate while billing is dark-launched and no checkout has happened
yet.

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
  (`lib/tags/tags-context.tsx`) exposes `groups` (customizable names, stable
  ids, rename/delete via the manager modal) and `assignments[assetId][groupId]
  = string[]`. Since round 22 tags **ride the full store seam** (owner
  override of the earlier localStorage-only decision): `PortfolioData` carries
  `tagGroups`/`tagAssignments`, tables `tag_groups` + `asset_tags` (migration
  0062, RLS per user, FK cascade on asset/group delete), store methods
  `addTagGroup`/`renameTagGroup`/`deleteTagGroup`/`setAssetTags`
  (replace-set semantics, replay-idempotent through the offline queue).
  `TagsProvider` is a thin adapter over `usePortfolio()`; on first load it
  replays a leftover legacy `fintrack-tags` localStorage key into the store
  (only when the store has zero groups), then renames it to
  `fintrack-tags-imported`. Disclosed in `/datenschutz` (guest = local blob,
  registered = DB). The Analysis "Custom"
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

### LLM assistant (BYO key)

An opt-in chat bubble (flag `llmChat`, seeded **disabled**) lets the user ask
natural-language questions about their own portfolio using an API key they
bring themselves — no FinTrack-hosted key, no autonomous mutations. The
provider seam is `LlmProvider` (`lib/llm/types.ts`), mirroring `DataStore`/
`PriceProvider`: `{ id, label, models, buildRequest, buildPingRequest,
extractDelta, extractPingText, chat }`. `lib/llm/index.ts` is the registry
(`providers`/`providerList`/`getProvider`) — adding a vendor means one file
under `providers/` plus one registry entry; **UI, context, and route code
never branch on the provider id.**

All vendor traffic goes through the server proxy `/api/llm`
(`app/api/llm/route.ts`) — the browser never contacts a vendor origin
directly, so CSP `connect-src` stays untouched (`'self'` + `*.supabase.co`,
same "market-data calls are server-side by design" rule as Yahoo/Frankfurter).
The route reads the key from the request body, uses it once per request, and
never logs, persists, or echoes it; vendor error bodies are drained and
discarded, and responses carry only a machine-readable `LlmErrorCode`
(`invalidKey`/`rateLimited`/`providerDown`/`badRequest`/`network`), localized
client-side (`lib/llm/error-messages.ts`). The route normalizes every
vendor's SSE into one uniform delta stream (`data: {"delta":...}` frames, an
error frame, a `[DONE]` sentinel via `lib/llm/sse.ts`) so the client adapter
never parses vendor-specific SSE. Rate-limited and payload-capped (256 KB)
like `/api/share`; a client disconnect aborts `req.signal`, which cancels the
upstream fetch.

`llmConfig` (provider/model/key) rides the **full store seam** like tags and
watchlist (owner override of `LLM_INTEGRATION.md`'s original "localStorage
only" decision, same precedent as round-22 tags): `PortfolioData` carries
`llmConfig`, table `llm_settings` persists it for registered users (one row
per user, RLS, upsert-on-save / delete-on-removal — always replace-set and
replay-idempotent), Guest Mode keeps it in the `LocalStore` blob, and
`OfflineStore` mirrors + queues it through `lib/offline/sync.ts` like any
other mutation. Registered users additionally choose the storage **scope**
(owner requirement, 2026-07-17): the account row above, or browser-only via
the `fintrack-llm` localStorage key (`lib/llm/browser-config.ts`) — its mere
presence wins over the account row (`lib/llm/config-precedence.ts`,
`resolveActiveLlmConfig`, pure/unit-tested). `LlmConfigProvider`
(`lib/llm/llm-context.tsx`) exposes `{config, scope, setConfig, clearConfig}`
and is mounted inside `PortfolioProvider`; `setConfig(config, scope)` moves
the key between the two locations, clearing the other. A browser-scoped key
is cleared on sign-out (`lib/auth/auth-context.tsx`, next to the history
cache) since it's scoped to that browser session by the user's own choice;
the account-scoped key survives sign-out like the rest of `PortfolioData`.
Guest Mode has no scope choice (the guest blob IS the browser) and never
renders the control.

Chat context is built client-side, pure, no React (`lib/llm/context.ts`,
`buildPortfolioContext`/`buildSystemPrompt`): a compact JSON snapshot of
holdings, savings plans, risk/allocation stats, sent as the system-prompt
preamble. Risk stats feed from real 5y histories plus portfolio beta/alpha
vs MSCI World (`risk.vsBenchmark`) — the same composite-levels math as the
risk page KPI tiles; `usePortfolioChat(active)` arms those history/benchmark
fetches only once the panel is first opened, and the per-conversation system
prompt isn't cached until they've landed (rebuilt per send meanwhile). It deliberately **never includes internal ids** (asset/portfolio/
transaction id — display data only: name, ISIN, type, ...) and **never
includes the tax report** (Freistellungsauftrag amounts stay out, per the
plan's open question). `/datenschutz` documents the BYO-key opt-in, where the
key can be stored (always browser-local for guests; account DB or
browser-local, by choice, for registered users), and that portfolio
data is transmitted to the chosen provider only when the chat is used — keep
that section accurate if these data flows change, same rule as the rest of
the privacy policy.

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
- `returns.ts` `windowChange` — the hero's "Change (tf)" KPI: abs = raw
  net-worth delta, pct = contribution-adjusted return. Flows on/before the
  first nonzero series point are **embedded in the baseline** and must never
  be subtracted again (a day-one portfolio once read −100%).
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
  /dividends page shows skeletons while events are in flight. The 12-month
  forecast (`projectDividends`, pure) projects trailing per-share events at
  the CURRENT share count, deliberately independent of received-payment
  history — a payer bought today still forecasts; only received figures scale
  by shares held on each pay date. **Announced dividend calendar**
  (COMPETITION.md F4, flag `dividendCalendar`): confirmed upcoming ex/pay
  dates come from Yahoo `quoteSummary.calendarEvents` (`announcedByQuery` /
  `/api/dividends/calendar` / `useAnnouncedDividends`, hint-authoritative like
  dividends). Unlike the keyless v8 chart, quoteSummary needs a cookie+crumb
  (`getCrumb`/`quoteSummaryJSON` in yahoo.ts) — it **fails soft to null**, so
  the forecast keeps its trailing projection. The pure `applyAnnouncedDate`
  re-dates the next projected payment to the confirmed date and flags it
  `confirmed`; the projection stays the fallback. The /dividends page surfaces
  this as a **single "Upcoming dividends" card** — a sortable Asset / Ex-date /
  Pay-date / Amount table over the projected next-12-months payouts (the old
  standalone announced-only calendar card and the separate forecast list were
  merged: a confirmed-dates-only card sat empty next to a filled forecast,
  which read as broken). Projected rows show the amount with a `≈` and no
  ex-date; where the announced calendar (gated on `dividendCalendar`) has a
  confirmed ex/pay date it fills the ex-date column and marks the pay date
  `confirmed`. The `≈` stays on **every** amount — only the date is ever
  confirmed, never the projected amount.
- **Vorabpauschale estimator** (`tax.ts` `estimateVorabpauschaleByYear` /
  `fundVorabpauschale`, COMPETITION.md F6, flag `vorabEstimate`): per fund per
  completed year, `startValue x Basiszins x 0.7 − distributions`, capped at the
  value gain. Basiszins is DB-seeded reference data (`basiszins` table,
  world-readable, `useBasiszins`) — never hardcoded. RAW (pre-Teilfreistellung,
  applied downstream); fills the manual `taxVorabpauschale` slot per year, the
  manual entry always overrides.
- **Accounts & liabilities** (`accounts.ts`, ROADMAP #1, flag `accounts`,
  seeded disabled): the keystone that lets net worth go **negative**. An
  `Account` (kind checking/savings/credit/loan/mortgage/other) is a balance the
  user sets, NOT a holding priced from a market — distinct from `OTHER` assets
  (which are positive manual-valuation holdings). `openingBalance` at `openedOn`
  plus dated `AccountBalance` readings form a carry-forward step series (like
  `ValuationPoint`); contribution to net worth is signed `(isLiability ? -1 :
  1) * balance`, FX-converted at spot. Rides the **full store seam** (`accounts`
  + `account_balances` tables migration 0080, RLS, FK cascade; LocalStore
  backfill; OfflineStore mirror+queue; `setAccountBalances` replace-set like
  `setAssetValuations`). Folded into `netWorthSeries` via optional
  `accounts`/`accountBalances` params (empty ⇒ 0, so the finance core never
  gates on the flag; MAX/YTD anchors also on earliest `openedOn`). The dashboard
  hero and AI context (`lib/llm/context.ts`, id-free) include accounts only when
  the flag is on. Surface is `/accounts`.

### Web push notifications (COMPETITION.md F5, flag `pushNotifications`)

Opt-in per event (dividend pay-day, savings-plan due) in settings, **registered
only**, seeded **disabled**. Strictly reminders, never marketing. VAPID keys
are DB-first (`app_settings.vapid_*`) with a `VAPID_*` env fallback, resolved by
`getVapidKeys()` (`lib/server/push-keys.ts`) mirroring `getStripeKeys` exactly;
the public key is served by `/api/push/vapid`. Subscriptions live in
`push_subscriptions` (own-row RLS, per-sub prefs, `last_notified_on` de-dupe);
`/api/push/subscribe`+`/unsubscribe` use session-bearer auth. The daily cron
`/api/cron/sync/push` (in the bulk sync, skips cleanly with no keys) computes
due savings plans + due dividends (announced payDate == today), sends localized
payloads via the `web-push` library (`lib/server/push.ts`), and deletes dead
subscriptions on 404/410. SW `push`/`notificationclick` handlers in
`public/sw.js`; client subscribe/unsubscribe in `lib/push/client.ts`.

### Routes

- `/` — dashboard: net-worth hero chart + add-asset + sortable/filterable
  table, plus the savings-plans card (flag `savingsPlans`) and watchlist card
  (flag `watchlist`)
- `/accounts` — balance accounts & liabilities (flag `accounts`, ROADMAP #1):
  add-account form + sortable list + per-account dated-balance editor
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
  TTL caches. Never fetch Yahoo endpoints directly from elsewhere. The one
  exception is the crumb-authenticated `quoteSummaryJSON` (announced dividend
  calendar, F4): `quoteSummary` needs a cookie+crumb the keyless v8 chart
  doesn't, so it has its own fetch — but it still shares the same semaphore +
  cooldown breaker and fails soft (any error → null).
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
  requires `CRON_SECRET` at the middleware edge. Every `/api/cron/*` route
  must also export `maxDuration = 300`: the bulk `/api/cron/sync` self-calls
  each sub-sync over HTTP, so each invocation is its own Vercel function with
  its own duration budget, not a shared one.
- The self-hosted error log (`error_logs`, migration 0069) is classified by
  severity `level` (`debug|info|warn|error|fatal`, the primary field and the
  `/admin/errors` filter) with the capture-source `kind`
  (boundary/window/unhandledrejection) as a secondary display column —
  `reportError()` (`lib/errors/report.ts`) defaults `level` to `"error"`.
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
