-- Migration: track the currency of cached benchmark history. Closes are stored
-- converted to the app base currency via historic FX, so benchmark returns are
-- comparable to home-currency holdings. Idempotent.

alter table public.benchmark_history add column if not exists currency text;

insert into public.schema_migrations (version) values ('0015_benchmark_currency')
on conflict (version) do nothing;
