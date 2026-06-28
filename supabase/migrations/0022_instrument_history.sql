-- Migration: cache REAL price history per asset so the /api/history route
-- doesn't re-hit Yahoo/CoinGecko on every load. Keyed by (price_key, range,
-- date), in the asset's native currency. World-readable reference data written
-- by the service role; `synced_at` drives staleness. Idempotent.

create table if not exists public.instrument_history (
  price_key text not null,
  range text not null,
  date date not null,
  close numeric not null,
  synced_at timestamptz not null default now(),
  primary key (price_key, range, date)
);
create index if not exists instrument_history_key_range_date_idx
  on public.instrument_history (price_key, range, date desc);

alter table public.instrument_history enable row level security;
drop policy if exists "instrument history readable" on public.instrument_history;
create policy "instrument history readable" on public.instrument_history for select using (true);

insert into public.schema_migrations (version) values ('0022_instrument_history')
on conflict (version) do nothing;
