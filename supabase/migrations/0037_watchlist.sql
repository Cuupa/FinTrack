-- Watchlist: instruments the user follows without holding them. Items link to
-- the shared instruments catalog (like assets), so price lookup and display
-- reuse the same reference data.
create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid not null references public.instruments (id),
  created_at timestamptz not null default now()
);
create index if not exists watchlist_items_user_id_idx on public.watchlist_items (user_id);
-- One row per (user, instrument): re-adding a watched instrument is a no-op
-- (and lets the offline replay treat a duplicate insert as already-synced).
create unique index if not exists watchlist_items_user_instrument_key
  on public.watchlist_items (user_id, instrument_id);

alter table public.watchlist_items enable row level security;
drop policy if exists "own watchlist" on public.watchlist_items;
create policy "own watchlist" on public.watchlist_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.feature_flags (flag, description) values
  ('watchlist', 'Watchlist card on the dashboard')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0037_watchlist')
on conflict (version) do nothing;
