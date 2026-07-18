-- MONETIZATION.md Phase 2 (dark launch): the plan-gating schema, with every
-- flag still seeded 'free' so there is zero visible change. `required_plan`
-- lets the owner tier a feature to Pro later (Phase 3) without a migration;
-- `plan_limits` holds the free/pro quantity caps for watchlist items, savings
-- plans and portfolios (null = unlimited, the owner sets caps later).
-- Idempotent.

alter table public.feature_flags
  add column if not exists required_plan text not null default 'free';

alter table public.feature_flags
  drop constraint if exists feature_flags_required_plan_check;
alter table public.feature_flags
  add constraint feature_flags_required_plan_check check (required_plan in ('free', 'pro'));

create table if not exists public.plan_limits (
  limit_key text primary key,
  free_value integer,
  pro_value integer,
  updated_at timestamptz not null default now()
);
alter table public.plan_limits enable row level security;

-- World-readable like feature_flags; no client insert/update/delete policies
-- (owner-written only, service role / dashboard bypasses RLS).
drop policy if exists "plan limits readable" on public.plan_limits;
create policy "plan limits readable" on public.plan_limits
  for select using (true);

insert into public.plan_limits (limit_key, free_value, pro_value) values
  ('watchlistItems', null, null),
  ('savingsPlans', null, null),
  ('portfolios', null, null)
on conflict (limit_key) do nothing;

insert into public.schema_migrations (version) values ('0065_plan_gating')
on conflict (version) do nothing;
