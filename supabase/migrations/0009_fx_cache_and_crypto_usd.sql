-- Migration: cache FX rates in the DB (refreshed by the price-sync cron) and
-- price crypto in USD so it FX-converts like other foreign-currency assets.
-- The web app then reads prices AND FX from the catalog cache — no client-side
-- external calls. Idempotent.

-- FX rates anchored to EUR: `rate` = units of `currency` per 1 EUR.
create table if not exists public.fx_rates (
  currency text primary key,
  rate numeric not null,
  synced_at timestamptz not null default now()
);
alter table public.fx_rates enable row level security;
drop policy if exists "fx readable" on public.fx_rates;
create policy "fx readable" on public.fx_rates for select using (true);

-- Seed approximate rates so conversion works before the first cron run.
insert into public.fx_rates (currency, rate) values
  ('EUR', 1),
  ('USD', 1.08),
  ('GBP', 0.85),
  ('CHF', 0.95),
  ('JPY', 170),
  ('CAD', 1.47),
  ('AUD', 1.63)
on conflict (currency) do nothing;

-- Crypto is cached/priced in USD (it has no fixed native currency), so the FX
-- layer converts it to the user's base like any USD asset.
update public.instruments set currency = 'USD' where type = 'CRYPTO';
