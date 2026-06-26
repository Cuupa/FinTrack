-- Migration: cache live prices in the DB so a cron job refreshes them server-
-- side (avoiding per-client rate limiting). The web app reads these cached
-- prices instead of polling the providers. Idempotent.

alter table public.instruments add column if not exists last_price numeric;
alter table public.instruments add column if not exists price_synced_at timestamptz;
