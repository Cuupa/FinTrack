-- Manual-valuation assets (COMPETITION.md F8, closes most of G9): a new asset
-- type OTHER (real estate, collectibles, unlisted holdings) that no market data
-- source can price. The user enters dated valuation points; those points form
-- the asset's price series through the PriceProvider seam
-- (lib/finance/manual-valuation.ts). Points ride the DataStore seam like tags:
-- Guest Mode keeps them in the localStorage blob, registered users get this
-- table (own-row RLS, FK cascade on asset delete). One row per (asset, date);
-- `setAssetValuations` replaces the full set for an asset by delete-then-insert,
-- so replay is idempotent.
create table if not exists public.asset_valuations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  valued_on date not null,
  value numeric not null,
  created_at timestamptz not null default now()
);
create unique index if not exists asset_valuations_unique_key
  on public.asset_valuations (asset_id, valued_on);
create index if not exists asset_valuations_asset_id_idx on public.asset_valuations (asset_id);
create index if not exists asset_valuations_user_id_idx on public.asset_valuations (user_id);

alter table public.asset_valuations enable row level security;
drop policy if exists "own asset valuations" on public.asset_valuations;
create policy "own asset valuations" on public.asset_valuations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seeded DISABLED (dark-launched): the OTHER asset type + valuation editor only
-- appear once the owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('manualValuation', false, 'Manual-valuation OTHER assets (real estate, collectibles) with user-entered valuation points')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0079_manual_valuation')
on conflict (version) do nothing;
