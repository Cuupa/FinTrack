-- Adds a name-resolution staleness marker (mirrors price_synced_at /
-- dividend_synced_at) so the names-sync cron can find instruments whose
-- official name hasn't been (re)resolved recently and re-run safely.

alter table public.instruments add column if not exists name_synced_at timestamptz;

insert into public.schema_migrations (version) values ('0042_instrument_name_sync')
on conflict (version) do nothing;
