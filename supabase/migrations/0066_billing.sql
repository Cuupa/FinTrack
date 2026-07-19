-- MONETIZATION.md Phase 1: the Stripe billing schema. Redirect-based
-- integration (Checkout + Billing portal, no on-page Stripe JS) so CSP
-- connect-src stays untouched; every table here is written only by the
-- webhook / reconcile cron via the service role, never by the client.
-- `billing_config` holds the price ids (config-in-DB, like `site_config`)
-- so the owner can change prices or disable selling without a redeploy. The
-- whole feature ships behind the `billing` flag, seeded disabled until
-- webhooks are verified live. Idempotent.

-- 1:1 user <-> Stripe customer.
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

-- Webhook idempotency ledger (Stripe retries; replays must be no-ops). A
-- retention cron prunes rows older than 30 days (existing retention pattern).
create table if not exists public.stripe_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;

-- Select-own only, no client insert/update/delete policies (service role
-- bypasses RLS; writes happen only server-side via the webhook/cron).
drop policy if exists "own billing customer" on public.billing_customers;
create policy "own billing customer" on public.billing_customers
  for select using (auth.uid() = user_id);
drop policy if exists "own subscription" on public.subscriptions;
create policy "own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

-- stripe_events has RLS enabled and no policies at all: not even the owning
-- user can read it, it is a server-only idempotency ledger.

-- Single-row config for Stripe price ids, world-readable, owner-written only
-- (same shape as app_settings/site_config). Prices are null until the owner
-- fills them in; `enabled` gates selling independently of the `billing` flag.
create table if not exists public.billing_config (
  id integer primary key check (id = 1),
  price_monthly text,
  price_yearly text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.billing_config enable row level security;
drop policy if exists "billing config readable" on public.billing_config;
create policy "billing config readable" on public.billing_config
  for select using (true);

insert into public.billing_config (id, price_monthly, price_yearly, enabled) values
  (1, null, null, false)
on conflict (id) do nothing;

-- Seeded DISABLED like llmChat (0063): the owner flips it on once webhooks
-- are verified live.
insert into public.feature_flags (flag, enabled, description) values
  ('billing', false, 'Stripe subscription billing (Checkout, portal, Pro plan)')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0066_billing')
on conflict (version) do nothing;
