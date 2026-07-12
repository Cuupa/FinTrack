# MONETIZATION.md - FinTrack Pro design

Status: DESIGN (round 20, 2026-07-12). No billing code exists yet. This document
is the plan the TODO asked for: monetization model, free/paid feature split,
detailed Stripe integration, and the admin settings for paywalling. Nothing in
here ships until the owner signs off on the open decisions at the bottom.

## 1. Model: freemium subscription, one paid tier

**FinTrack Free** (default for guests and registered users) and **FinTrack Pro**
(paid subscription).

Why a subscription and not the alternatives:

- **Ads / analytics-funded**: ruled out. `/datenschutz` makes verifiable claims
  (no analytics, essential-only storage, server-side market data). Ads would
  falsify the privacy policy and the product's core trust story.
- **One-time purchase**: mismatched with recurring costs (Supabase, Vercel,
  market-data polling crons, FX APIs) that scale with active users forever.
- **Usage credits**: wrong shape; the app polls prices continuously, there is
  no natural metered unit a user would understand.
- **Two tiers only**: keeps entitlement logic a boolean (`free` | `pro`). The
  plan column is text, so a third tier (e.g. `family`) can slot in later
  without a schema change.

Suggested pricing (owner decision, see section 7):

| Price | Amount | Notes |
|---|---|---|
| Pro monthly | 4.99 EUR / month | anchor price |
| Pro yearly | 39 EUR / year (~3.25 EUR/month) | push annual, ~35% discount |
| Trial | 14 days, card required | Stripe `trial_period_days`, cancel anytime |

Currency EUR, VAT via Stripe Tax (section 5). Target market is DACH: the
German tax report, Vorabpauschale handling and broker CSV imports are the
differentiators, so pricing and copy assume a German-speaking retail investor
(du register, as everywhere).

### Guest Mode

Guest Mode stays free and fully local. Entitlements are keyed by `user_id`, and
checkout needs an account anyway (Stripe customer, receipts, restore on a new
device). So:

- Guests get exactly the Free feature set.
- Pro surfaces show the same locked teaser as for free registered users, with
  "create an account" as the first step of the upgrade path.
- Enforcement in Guest Mode is client-side only and that is fine: guest data is
  local, the paywall there is a conversion funnel, not a security boundary.
  For registered users the entitlement is read from the DB and Pro-only API
  behavior (if any is ever added) is enforced server-side.

### Never paywalled (hard constraints)

- **The user's own data**: viewing holdings, adding/editing/deleting
  transactions, and both exports (`exportCsv`, `exportJson`). Data portability
  is a GDPR expectation and the basis of the trust story. A paywall that holds
  data hostage would poison every review.
- **Account deletion, legal pages, security features.**
- **Infrastructure flags** stay pure kill switches and never get a plan tier:
  `offline`, `historyCache`, `estimated-badge`, `errorLogging`.

## 2. Free vs Pro split

Principle: **Free = complete tracking. Pro = analysis, automation, and scale.**
Getting data in and seeing an honest net-worth picture must be frictionless
(activation); the deep analysis a user grows into is what converts.

### Existing feature flags, tiered

| Flag | Feature | Tier | Rationale |
|---|---|---|---|
| (none) | Dashboard, holdings, transactions, net-worth chart, live prices, multi-currency, asset detail | Free | Core value; without it nothing else matters |
| `csvImport` | Broker CSV import | Free | The main activation path; paywalling data entry kills adoption before day one |
| `exportCsv` / `exportJson` | Portfolio export | Free | Data portability, never paywalled (section 1) |
| `watchlist` | Watchlist card | Free, limited | 5 items free, unlimited Pro (see limits) |
| `savingsPlans` | Savings plans card | Free, limited | 2 plans free, unlimited Pro |
| `dividends` | /dividends dashboard (income, yield, forecast) | **Pro** | High perceived value; the per-asset dividends section on the detail page stays free so the data is never hidden |
| `taxReport` | Steuern tab (German tax estimate, Vorabpauschale) | **Pro** | The DACH killer feature, strongest conversion lever |
| `risk` | Analysis risk tab | **Pro** | Power analysis |
| `xray` | ETF look-through | **Pro** | Power analysis, catalog-data heavy |
| `rebalance` | Rebalancing | **Pro** | Power tool |
| `simulation` (+ `simulationPortfolio` / `simulationCustom` / `simulationWithdrawal`) | Monte Carlo | **Pro** | Compute-heavy power tool; the sub-flags inherit, only the parent gets a tier |
| `offline`, `historyCache`, `estimated-badge`, `errorLogging` | Infrastructure | Free (excluded) | Kill switches, never tiered |

Distributions, returns and trades tabs on /analysis stay free: seeing what you
own and what it returned is "tracking", not "analysis" in the paywall sense.

### Quantity limits (new, `plan_limits`)

| Limit key | Free | Pro |
|---|---|---|
| `watchlistItems` | 5 | unlimited |
| `savingsPlans` | 2 | unlimited |
| `portfolios` | 1 | unlimited |
| holdings / transactions | unlimited | unlimited (never punish tracking) |

Limits are enforced at the add-surface (button disabled + teaser when at the
cap), never retroactively: a user who downgrades keeps existing rows read/write
but cannot add beyond the cap.

### Locked vs disabled (important UX distinction)

- Flag `enabled = false` (kill switch): feature vanishes entirely, exactly as
  today.
- Flag enabled but plan-gated and user is Free: the surface renders a **locked
  teaser** (feature name, one-line pitch, "Pro" badge, upgrade button) instead
  of disappearing. A feature nobody can see converts nobody.

## 3. Stripe integration design

### Architecture choice: redirect-based, zero on-page Stripe JS

Stripe Checkout (hosted page) for purchase and the Stripe Billing customer
portal for self-service (change plan, payment method, cancel, invoices). The
app only ever redirects; no Stripe.js, no embedded elements. Consequences:

- **CSP untouched**: `connect-src 'self' *.supabase.co` stays as is. This is
  the decisive argument; embedded elements would force `js.stripe.com` +
  `api.stripe.com` into the CSP and add PCI surface.
- Minimal PCI scope (SAQ A), no card data near the app.
- All Stripe calls are server-side (matches the market-data convention).

### Configuration

- Env vars (Vercel): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. These are
  credentials, so env is correct.
- **Price IDs live in the DB, not env** (config-in-DB convention, like
  `site_config`): table `billing_config` (single row: `price_monthly`,
  `price_yearly`, `enabled`), world-readable, owner-written. The owner can
  change prices or disable selling without a redeploy.
- The whole billing feature ships behind a `billing` feature flag row (off in
  prod until webhooks are verified live).

### Schema (migration `00xx_billing.sql` + schema.sql mirror, idempotent)

```sql
-- 1:1 user <-> Stripe customer
create table if not exists public.billing_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

-- Mirror of the Stripe subscription state; written ONLY by the webhook /
-- reconcile cron (service role). Client reads its own row.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_subscription_id text not null unique,
  status text not null,              -- Stripe status verbatim
  plan text not null default 'pro',  -- derived from price id
  price_id text not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Webhook idempotency ledger (Stripe retries; replays must be no-ops)
create table if not exists public.stripe_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);
```

RLS: `billing_customers` and `subscriptions` select-own only
(`auth.uid() = user_id`), no client insert/update/delete policies (service
role bypasses RLS). `stripe_events` no client policies at all. Retention cron
prunes `stripe_events` older than 30 days (existing retention pattern).

### Entitlement derivation (one function, one place)

```
plan(user) = 'pro'  if subscriptions.status in ('active', 'trialing')
             'pro'  if status = 'past_due' and now() < current_period_end + 7 days   -- grace
             'free' otherwise (or no row, or guest, or no Supabase)
```

Client-side: a `BillingProvider` under `AuthProvider` loads the user's
subscription row once per session (plus on `?billing=success` return) and
exposes `usePlan()`. Feature resolution consumes it (section 4). Server-side:
the same rule as a SQL helper `public.user_plan(uid)` for any future Pro-only
API route.

### API routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/billing/checkout` | POST | session required | Create Checkout Session (mode `subscription`, price from `billing_config`, `customer` reused from `billing_customers` or created + persisted, `client_reference_id` = user id, `success_url` `/settings?billing=success`, `cancel_url` `/settings?billing=cancelled`, `automatic_tax.enabled`, `allow_promotion_codes`). Returns the redirect URL. |
| `/api/billing/portal` | POST | session required | Create a Billing-portal session for the user's customer id, return redirect URL. |
| `/api/billing/webhook` | POST | Stripe signature | Source of truth for subscription state (below). |
| `/api/cron/sync/billing` | POST | `CRON_SECRET` (middleware, existing pattern) | Daily reconcile: list non-`free` local rows, re-fetch from Stripe, repair drift (missed webhooks happen). |

`/api/billing/checkout` and `/portal` get the existing DB-backed per-IP rate
limit (`lib/server/rate-limit.ts`).

### Webhook handling

- Verify `stripe-signature` against the **raw request body**
  (`await req.text()` before any JSON parse; Node runtime, not edge).
- Idempotency: insert `event.id` into `stripe_events`; on conflict, return 200
  immediately.
- Handled events, all funneled into one `upsertSubscription(sub)`:
  - `checkout.session.completed` -> resolve subscription, upsert row, ensure
    `billing_customers` mapping (from `client_reference_id` + `customer`).
  - `customer.subscription.created` / `updated` -> upsert (status, price,
    period end, `cancel_at_period_end`).
  - `customer.subscription.deleted` -> status `canceled` (row kept for
    history; entitlement falls to free via the derivation rule).
  - `invoice.payment_failed` -> nothing special; the subscription's own
    `past_due` status plus the grace rule covers it.
- Unhandled event types: 200, ignore. Handler errors: 500 so Stripe retries.
- User identity mapping: `client_reference_id` on checkout; afterwards
  `stripe_customer_id -> billing_customers`. Never trust an email for mapping.

### Subscription lifecycle

| Event | State | Entitlement |
|---|---|---|
| Checkout completed | `trialing` / `active` | Pro immediately |
| Renewal paid | `active` | Pro |
| Payment fails | `past_due` (Stripe retries per dunning settings) | Pro for 7 days grace, then Free |
| User cancels in portal | `active` + `cancel_at_period_end` | Pro until period end, settings shows "ends on ..." |
| Period ends after cancel | `canceled` | Free; **no data is ever deleted**, Pro surfaces re-lock to teasers, over-cap rows stay usable (section 2) |

### Settings UI

The existing /settings gets a "Subscription" card (flag-gated by `billing`):
current plan, renewal/end date, "Upgrade" (checkout redirect, monthly/yearly
choice), "Manage subscription" (portal redirect) for subscribers. Locked
teasers elsewhere deep-link here. A dedicated marketing /pricing page is
Phase 3 (section 6). EN==DE du copy throughout, no em-dashes.

### Testing

- Stripe test mode + `stripe` CLI (`stripe listen --forward-to
  localhost:3000/api/billing/webhook`, `stripe trigger ...`) for the full
  event matrix; test clocks for renewal/dunning transitions.
- Unit tests: entitlement derivation (pure), webhook event -> upsert mapping
  with fixture payloads (signature check mocked at the boundary), grace-period
  boundary cases. No supabase-js chain mocks (repo convention); extract the
  pure parts.
- The webhook route is exempt from `CRON_SECRET` middleware but protected by
  signature verification; add a test that an unsigned request is rejected.

## 4. Admin paywall settings

Goal from the TODO: the owner decides per feature what is paywalled, at
runtime, without a deploy.

### Data model: extend `feature_flags`

```sql
alter table public.feature_flags
  add column if not exists required_plan text not null default 'free'
  check (required_plan in ('free', 'pro'));

create table if not exists public.plan_limits (
  limit_key text primary key,          -- 'watchlistItems' | 'savingsPlans' | 'portfolios'
  free_value integer,                  -- null = unlimited
  pro_value integer,                   -- null = unlimited
  updated_at timestamptz not null default now()
);
```

Both world-readable (same RLS shape as `feature_flags`), owner-written via the
admin API (service role). Seed `required_plan = 'pro'` for the section-2 set in
the same migration; the owner can re-tier any flag afterwards in the UI.

### Resolution order (per flag, per user)

1. `user_feature_flags` override exists -> **wins outright** (existing
   semantics, now doubling as a support/beta grant: an override with
   `enabled = true` unlocks a Pro feature for that user regardless of plan).
2. `feature_flags.enabled = false` -> off (kill switch, invisible).
3. `required_plan = 'pro'` and `usePlan() = 'free'` -> **locked** (visible
   teaser, not functional).
4. Otherwise -> on.
5. No Supabase / missing row -> on, `required_plan 'free'` (open-source
   self-hosters keep everything; only rows the owner seeds become gated).

### Client seam (keeps every existing call site working)

- `FeatureFlagsProvider` already loads the flag rows; it additionally reads
  `required_plan` and consumes `usePlan()`.
- New hook `useFeature(flag): { enabled: boolean; locked: boolean }`.
- **`useFeatureFlag(flag)` keeps its boolean contract** and becomes
  `enabled && !locked`. All 20+ existing call sites behave correctly (locked =
  hidden) with zero changes; surfaces that should show the upsell teaser adopt
  `useFeature` + a shared `<ProTeaser feature="...">` component incrementally
  (Phase 3), starting with the /analysis tabs, /dividends, /simulation, /xray,
  /rebalancing.
- Limits: `usePlanLimit(key)` reads `plan_limits` by plan; add-surfaces
  (watchlist add, savings-plan form, portfolio picker) disable + teaser at cap.

### /admin/flags

The existing flags table gains a **plan column**: a free/pro select per row,
written through the existing admin API (requireAdmin + service role, audited
like current flag writes). The per-user override form already exists and
needs no change to act as the grant mechanism. `plan_limits` gets a small
editor card on /admin/site (three numeric inputs, empty = unlimited). Tables
stay sortable with row hover (standing rule).

## 5. Legal & compliance (must ship with Phase 3, not after)

- **/datenschutz**: add Stripe as payment processor (data shared: email,
  payment metadata; link Stripe's privacy policy). The page makes verifiable
  claims, keep it accurate the moment the first checkout is possible.
- **/terms**: subscription terms (renewal, cancellation, trial, price-change
  notice), EN+DE du.
- **Widerrufsrecht** (EU digital services): 14-day withdrawal; Checkout must
  collect the standard consent ("Ausführung vor Ablauf der Widerrufsfrist")
  via Stripe's consent collection, or the trial de-facto covers it (owner +
  legal decision).
- **VAT**: Stripe Tax with automatic tax on Checkout; owner decides
  Kleinunternehmerregelung (§19 UStG) vs regular VAT before going live.
- **Impressum**: already exists; verify the operator identity in `site_config`
  is complete for a paid offering.

## 6. Rollout phases

| Phase | Ships | Risk gate |
|---|---|---|
| 0 | This document | Owner sign-off on section 7 |
| 1 | Billing schema + webhook + checkout/portal routes + settings card, all behind `billing` flag (off in prod) | Stripe test-mode matrix green; webhook verified on prod URL with flag still off |
| 2 | `required_plan` + `plan_limits` schema, `usePlan`/`useFeature` resolution, /admin/flags plan column; **every flag still seeded 'free'** | Dark launch: no visible change for anyone; verify resolution + overrides in prod |
| 3 | Flip `required_plan='pro'` on the section-2 set, `ProTeaser` surfaces, /pricing page, legal updates, `billing` flag on | First real checkout end-to-end in live mode |
| 4 | Quantity limits enforcement at add-surfaces | Grandfathering rule for over-cap users active before flipping |

Existing registered users at Phase 3: recommend a time-limited "founder"
`user_feature_flags` grant set or a promo code, owner decision.

## 7. Open decisions for the owner

1. Price points + trial (4.99/39 EUR, 14d card-required trial suggested).
2. Tier assignment sign-off, especially `dividends` (Pro here) and `csvImport`
   (deliberately Free here).
3. Grandfathering for existing users (grant set vs promo code vs nothing).
4. Kleinunternehmerregelung vs Stripe Tax + VAT registration.
5. Widerruf handling (consent checkbox vs trial-covers-it).
6. Live Stripe account + keys (needed before Phase 1 can be verified in prod).
