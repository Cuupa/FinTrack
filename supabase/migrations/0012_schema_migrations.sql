-- Migration: a system table recording which migrations have been applied, so
-- it's visible which schema changes a database has. Idempotent. New migrations
-- should append `insert into public.schema_migrations (version) values ('NNNN…')
-- on conflict do nothing;` at their end.

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
drop policy if exists "migrations readable" on public.schema_migrations;
create policy "migrations readable" on public.schema_migrations for select using (true);

-- Backfill every migration shipped so far as applied (a database running this
-- file has, by definition, the earlier ones).
insert into public.schema_migrations (version) values
  ('0001_isin_wkn_and_executed_at'),
  ('0002_instruments_catalog_and_currency'),
  ('0003_etf_constituents'),
  ('0004_country_and_dividends'),
  ('0005_yahoo_quote_source'),
  ('0006_normalize_3nf'),
  ('0007_expand_constituents'),
  ('0007_price_cache'),
  ('0007_sector_region'),
  ('0008_executed_at_naive'),
  ('0009_fx_cache_and_crypto_usd'),
  ('0010_drop_instrument_owner'),
  ('0011_asset_currency'),
  ('0012_schema_migrations')
on conflict (version) do nothing;
