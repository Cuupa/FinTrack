-- Asset tags: user-defined key-value tag groups + per-asset assignments,
-- moved off localStorage-only storage onto the DataStore seam so registered
-- users get DB persistence and cross-device sync (owner override of the
-- earlier "tags stay localStorage-only" decision). Guest Mode keeps them in
-- its localStorage blob (lib/store/local-store.ts), same as watchlist items
-- and savings plans.
create table if not exists public.tag_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists tag_groups_user_id_idx on public.tag_groups (user_id);

alter table public.tag_groups enable row level security;
drop policy if exists "own tag groups" on public.tag_groups;
create policy "own tag groups" on public.tag_groups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- One row per (asset, group, value) — `setAssetTags` replaces the full set
-- for a (asset, group) pair by deleting then re-inserting, so replay is
-- idempotent regardless of ordering.
create table if not exists public.asset_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  group_id uuid not null references public.tag_groups (id) on delete cascade,
  value text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists asset_tags_unique_key
  on public.asset_tags (asset_id, group_id, value);
-- Cascade/FK integrity paths (see 0045_fk_indexes.sql style).
create index if not exists asset_tags_asset_id_idx on public.asset_tags (asset_id);
create index if not exists asset_tags_group_id_idx on public.asset_tags (group_id);
create index if not exists asset_tags_user_id_idx on public.asset_tags (user_id);

alter table public.asset_tags enable row level security;
drop policy if exists "own asset tags" on public.asset_tags;
create policy "own asset tags" on public.asset_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.schema_migrations (version) values ('0062_asset_tags')
on conflict (version) do nothing;
