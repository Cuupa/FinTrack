# MONETIZATION.md

How FinTrack sells: plan gating, the paywall components, plan limits, billing
and the pricing page. CLAUDE.md keeps only the invariants and points here.

**Everything below is dark-launched.** Every flag is seeded
`required_plan='free'`, every `plan_limits` row is seeded unlimited, and the
`billing` flag is seeded disabled — so nothing locks, no teaser renders and
no checkout is reachable until the owner changes that at runtime on
`/admin/flags`, `/admin/site` and `/admin/billing`.

## Phase 2 — plan gating

`feature_flags` carries `required_plan` (`'free'|'pro'`, default `'free'`).
Resolution lives in `lib/flags/resolve.ts` (pure, unit-tested) and has **two
independent axes** (owner rule, 2026-07-26):

- the **flag** decides VISIBILITY — a per-user override, else the global
  `enabled` (missing row = off);
- the **plan** decides UNLOCKED — visible + pro-required + free plan yields
  `{ enabled: true, locked: true }`.

A per-user override is therefore **never a Pro grant**. It is the general
on/off plus testing switch, and it can equally switch a feature OFF for one
user. Granting Pro to one person is `plan_grants`, which lifts the plan
itself. A missing column/row or no Supabase resolves to free/on, so a database
lagging migration 0065 behaves exactly as it did before.

`useFeature(flag)` returns `{ enabled, locked }`. `useFeatureFlag` stays
boolean (`enabled && !locked`), which **hides** a locked feature — correct
only for infrastructural flags with nothing to sell (`offline`,
`historyCache`, `errorLogging`, `billing`, `estimated-badge`). Every
user-facing surface must read `useFeature` and render a teaser when locked.

### The billing seam

`usePlan()` (`lib/billing/use-plan.ts`) is a thin read of `BillingProvider`
(`lib/billing/billing-context.tsx`), mounted under `AuthProvider` and above
`FeatureFlagsProvider` in `components/providers.tsx` because flag resolution
consumes it. It loads the signed-in user's own `subscriptions` row and feeds
it through `resolvePlan` (`lib/billing/plan.ts`, pure: active/trialing/
past_due + 7d grace). Guests, no Supabase and not-yet-loaded all resolve
`"free"`.

`plan_grants` (migration 0068, "gratitude premium") independently grants a
user Pro until `expires_at`, or forever when null, regardless of any Stripe
subscription. `BillingProvider` loads the user's own grants (select-own RLS)
alongside their subscription, and `resolvePlan` honors an active grant as a
standalone path to `"pro"`. Grants are issued/revoked on `/admin/billing`'s
"Premium grants" card — service-role writes only, every grant and revoke
audited.

## Phase 3 — the paywall components

**Owner rule: a paywalled feature stays visible, never hidden.**

`<ProTeaser feature="...">` (`components/billing/pro-teaser.tsx`) renders the
real feature UI passed as `children` **blurred + `inert`** underneath a
centered paywall message (lock icon, "Pro feature" copy, upgrade CTA), so the
user sees a preview of what Pro unlocks rather than a blank card. Each call
site passes the same view it renders when unlocked:

```tsx
locked ? <ProTeaser feature="dividends"><DividendsView /></ProTeaser> : <DividendsView />
```

Loading/error gates stay **before** the lock, so a still-loading page shows
its skeleton rather than a blurred empty state. The preview is clipped to
`max-h-[70vh]` so the paywall message never sits below the fold on a tall
page. Called without `children` it falls back to a standalone empty-state
card. Its upgrade button only shows when the `billing` flag is on, and links
to `/pricing`.

Adopted on **every** surface that gates on a Pro flag: the /analysis risk and
tax tabs (the tab itself stays visible), /dividends, /simulation, /xray,
/rebalancing, the flag-gated pages /accounts, /spending, /goals, /health,
/retirement (per tab), /debt, the dashboard `AreaCards` (a locked area
keeps its grid slot) and the self-gated cards (watchlist, savings plans,
budgets — each split into a gate wrapper plus a `*Inner` holding the hooks).

Navigation matches: `Sidebar`/`MobileNav` filter on
`getFeature(flag).enabled`, so a **locked** route stays in the list with a
`LockIcon` (exported from pro-teaser.tsx) and only a flag that is off
outright disappears.

Two smaller wrappers gate a **sub-surface** without repeating the ternary:

- `<ProGate locked feature>` renders its children plainly or blurred behind
  the teaser — used by the simulation's parameter panel and withdrawal phase,
  the settings AI tab, the notifications card, the tax-pack sections, the
  insurance coverage-gaps card, the add-asset CSV-import tab, the
  asset-detail cash-interest and manual-valuation sections, and /household's
  create + invite cards.
- `<ProMenuItem label>` keeps a locked **dropdown row** listed with a padlock
  linking to /pricing (export CSV/JSON in the dashboard and profile menus) —
  a blurred preview makes no sense for a single menu row.

**Cell-level enrichments still hide while locked**, because they cannot carry
a teaser: a value inside a `dl`, one column of a table, a row action, an
option in a select (`vorabEstimate`, `dividendCalendar`, `splitDetection`,
`manualValuation`'s asset-type option,
`taxPack`'s category field). **Do not tier those to Pro on their own** — tier
the surface that owns them.

## Phase 4 — plan limits

`plan_limits` holds a free/pro cap per `limit_key` (`watchlistItems`,
`savingsPlans`, `portfolios`, `householdMembers`; null = unlimited, all
seeded unlimited). Pure resolution and the grandfathering rule live in
`lib/billing/limits.ts` (`resolveLimit`/`atLimit`, unit-tested): **`atLimit`
only ever blocks ADDING past the cap** and never hides or disables a row that
is already over it after a downgrade.

Loaded once in `FeatureFlagsProvider` (`lib/flags/flags-context.tsx`) — it
already loads the sibling world-readable `feature_flags` table with the same
shape and already consumes `usePlan()` — and surfaced via
`usePlanLimit(key)`.

Enforced at every add-surface:

- watchlist add (`components/dashboard/watchlist-card.tsx`),
- savings-plan create (`components/savings/plan-form.tsx`, shared by the
  dashboard card and the asset-detail "new plan" entry point),
- portfolio create (`components/portfolio-picker.tsx`, **plus every inline
  "+ New portfolio" `SelectMenu` footer that calls the same `createPortfolio`
  mutation** — `add-asset-form.tsx`, `transaction-form.tsx`,
  `import-transactions.tsx` — capped identically so none of them bypass the
  picker's limit).

A capped add-surface always shows an inline localized hint ("Free plan
includes up to {n} watchlist items", linking to /pricing when the `billing`
flag is on) instead of a silently disabled control. Caps are set on
/admin/site's "Plan limits" card (`POST /api/admin/site` `{ kind: "limits" }`,
validated by `lib/server/plan-limits-admin.ts`).

## Household is a paid family plan (migration 0101)

Household sharing is enforced by RLS (`household_peer_ids()`), and RLS knew
nothing about plans — so tiering the `household` flag to Pro only hid the
/household page while every shared row stayed visible on the dashboard,
/spending and /goals after a downgrade. The gate now lives where the sharing
happens:

- `user_has_pro()` mirrors `resolvePlan` in SQL. **Keep the two in step —
  same rule, twice.**
- `household_sharing_enabled()` = "flag not tiered to pro OR **some** member
  has Pro".
- `household_peer_ids()` returns an empty set when that is false, collapsing
  every shared policy back to plain self-ownership without deleting or
  reassigning anything.

So the unit of payment is the **household**, never the member: one
subscription covers everyone, and either side may carry it (the `join
household` policy accepts the creator's Pro or a joining invitee's).

`user_has_pro`/`household_has_pro` are deliberately **not** client-callable
(revoked from PUBLIC) — they would let anyone probe who pays. The client only
gets the own-household aggregate `household_sharing_active()`, surfaced as
`useHousehold().sharingActive` and rendered as a "sharing is paused" notice:
never leave a collapsed state looking normal.

/household therefore gates per **sub-surface**: create + invite sit behind
`<ProGate>`, while the invitations card, the members list and "leave
household" stay free — a free partner who cannot accept makes a family plan
pointless, and a member locked out of leaving would be trapped.
`plan_limits.householdMembers` caps head count, and pending invitations
reserve a seat.

## Phase 1 — billing (flag `billing`, seeded disabled)

Stripe Checkout + Billing portal, **redirect-based only** — no Stripe.js on
the page, so CSP `connect-src` stays untouched.

Price ids and the selling toggle live in `billing_config` (config-in-DB,
world-readable, owner-written), editable at runtime on `/admin/billing`. It
also carries owner-typed **display price strings**
(`price_monthly_display`/`price_yearly_display`, migration 0070, e.g.
"4,99 EUR") shown on `/pricing` — free text, never formatted or computed
with, distinct from the Stripe price ids; nullable, so `/pricing` shows the
plan comparison without an amount rather than inventing one while empty.

The Stripe secret key and webhook secret are **DB-first with an env
fallback**: `app_settings.stripe_secret_key`/`stripe_webhook_secret` (RLS
enabled, zero policies — service-role only) win over `STRIPE_SECRET_KEY`/
`STRIPE_WEBHOOK_SECRET` when set, resolved once per request by
`getStripeKeys()` (`lib/server/billing-keys.ts`). Every caller that touches a
key goes through it instead of reading `process.env` directly.

On `/admin/billing`: `GET /api/admin/billing` never echoes a stored secret
(presence booleans only); `POST` sets/clears a key (empty or `null` clears)
or upserts the config. Every write is audited, and key writes record only
"set"/"cleared" per field, **never the value**
(`lib/server/billing-admin.ts`, `app/api/admin/billing/route.ts`).

`/api/billing/checkout` and `/api/billing/portal` (POST, session bearer
token) return `{ url }` to redirect to. `/api/billing/webhook` is the **sole
writer** of `subscriptions` (service role; select-own RLS for the client).

Settings carries a "Subscription" card
(`components/settings/subscription-card.tsx`, flag-gated,
registered-users-only — guests cannot subscribe) reading `useBilling()` for
`{plan, subscription, loading}` and hitting the checkout/portal routes with
the session token, the same pattern as account deletion in
`components/settings/settings-view.tsx`. `BillingProvider` re-fetches once
after a short delay when the page was entered with `?billing=success`, since
the webhook can lag the Checkout redirect. The redirect call
(`lib/billing/checkout-client.ts`) is a shared helper so the settings card
and `/pricing` do not each reimplement it.

## Pricing page + legal

`/pricing` (`app/pricing/page.tsx`) is a Free-vs-Pro marketing comparison,
gated behind the `billing` flag the same way any other flag-gated route
degrades to `FeatureUnavailable`. It reads the display prices via
`useBillingConfig()` (`lib/billing/use-billing-config.ts`, a direct
world-readable-row read through the browser Supabase client, same shape as
`BillingProvider`'s own subscription fetch) with skeleton placeholders while
loading.

The CTA reuses `redirectToBilling`: registered users check out directly,
guests get a link to `/login`, an already-Pro user gets a link to manage
instead of a second checkout, and the buy buttons disappear
(comparison-only) when `billing_config.enabled` — the owner's selling toggle,
independent of the `billing` flag — is off.

`/datenschutz` and `/terms` (EN+DE) carry the legal sections required before
a real checkout is reachable:

- `/datenschutz` — Stripe payment processing: email + payment metadata shared
  with Stripe, FinTrack itself never stores card data, linked to Stripe's
  privacy policy.
- `/terms` — subscription terms: billing interval, auto-renewal, portal
  cancellation effective at period end, prices as shown at checkout, the EU
  14-day withdrawal right and its early-expiry consent at checkout.

Both are phrased conditionally ("Wenn du ein Abo abschließt, ...") so they
stay accurate while billing is dark-launched and no checkout has happened
yet.
