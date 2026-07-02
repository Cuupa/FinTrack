-- Migration: database-backed feature flags. A flag has a global default in
-- `feature_flags` (world-readable) that the owner flips via SQL/dashboard:
--   update public.feature_flags set enabled = false where flag = 'xray';
-- and an optional per-user override in `user_feature_flags` that wins over
-- the global value:
--   insert into public.user_feature_flags (user_id, flag, enabled)
--   values ('<auth.users uuid>', 'xray', true)
--   on conflict (user_id, flag) do update set enabled = excluded.enabled;
-- Both tables are written by the owner only (service role / dashboard —
-- bypasses RLS); clients read, never write. A flag missing from the table
-- counts as enabled. Idempotent.

create table if not exists public.feature_flags (
  flag text primary key,
  enabled boolean not null default true,
  description text,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_feature_flags (
  user_id uuid not null references auth.users (id) on delete cascade,
  flag text not null references public.feature_flags (flag) on delete cascade,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, flag)
);

alter table public.feature_flags enable row level security;
alter table public.user_feature_flags enable row level security;

-- Global flags are reference data like the catalog: world-readable, writes are
-- service-role only. Overrides are readable by the affected user alone.
drop policy if exists "feature flags readable" on public.feature_flags;
create policy "feature flags readable" on public.feature_flags
  for select using (true);
drop policy if exists "own feature flag overrides readable" on public.user_feature_flags;
create policy "own feature flag overrides readable" on public.user_feature_flags
  for select using (auth.uid() = user_id);

insert into public.feature_flags (flag, description) values
  ('csvImport', 'Broker CSV transaction import'),
  ('risk', 'Analysis — Risk section'),
  ('xray', 'X-Ray ETF look-through'),
  ('rebalance', 'Rebalancing'),
  ('simulation', 'Monte Carlo simulation (whole feature)'),
  ('simulationPortfolio', 'Simulation — My portfolio mode'),
  ('simulationCustom', 'Simulation — Custom mode'),
  ('simulationWithdrawal', 'Simulation — Withdrawal phase')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0027_feature_flags')
on conflict (version) do nothing;
