-- Migration: instruments are global reference data — drop the per-user `owner`
-- column. A user's portfolio links to shared instruments via `assets`; an
-- instrument is never tied to a user. Idempotent.

-- The symbol-uniqueness index and the RLS policies referenced `owner`; drop
-- them before the column, then re-create owner-free.
drop index if exists public.instruments_symbol_key;

drop policy if exists "instruments readable" on public.instruments;
drop policy if exists "own instruments write" on public.instruments;
drop policy if exists "instruments insertable" on public.instruments;

alter table public.instruments drop column if exists owner;

-- Symbol uniqueness across the whole catalog now (no owner scoping).
create unique index if not exists instruments_symbol_key
  on public.instruments (symbol) where symbol is not null;

-- World-readable; authenticated users may add new instruments; updates/deletes
-- are service-role only (the price-sync cron bypasses RLS).
create policy "instruments readable" on public.instruments
  for select using (true);
create policy "instruments insertable" on public.instruments
  for insert to authenticated with check (true);
