-- Adds a per-watchlist-item currency override, mirroring assets.currency:
-- null falls back to the shared instrument's currency.

alter table public.watchlist_items add column if not exists currency text;

insert into public.schema_migrations (version) values ('0041_watchlist_currency')
on conflict (version) do nothing;
