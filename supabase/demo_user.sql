-- Demo user portfolio: nightly self-resetting seed.
--
-- Defines public.reset_demo_portfolio(), which DROPS and REINSERTS a realistic,
-- diversified buy-and-hold portfolio for the demo user
-- 5e123991-eb12-4ae1-a6b1-8f224e59f4bb across three portfolios (Neobroker,
-- Bank, Crypto). A normal saver: periodic buys over a few years with the
-- occasional profit-taking sell — not random noise.
--
-- Then schedules it nightly via Supabase pg_cron and runs it once now.
-- Idempotent: re-running this file just redefines the function, re-creates the
-- schedule, and re-seeds. Run after schema.sql in the Supabase SQL editor.
--
-- The user must already exist in auth.users (the account was created already).

-- 1. The reset function -----------------------------------------------------
-- SECURITY DEFINER so the cron job (and the one-off call below) can write
-- across the demo user's rows regardless of RLS. Instruments are global catalog
-- data and are only inserted if missing — never deleted.
create or replace function public.reset_demo_portfolio()
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  demo_user uuid := '5e123991-eb12-4ae1-a6b1-8f224e59f4bb';
begin
  -- Base-currency profile.
  insert into public.profiles (id, currency, display_name)
  values (demo_user, 'EUR', 'Demo')
  on conflict (id) do nothing;

  -- Instruments (global catalog) — equities/funds price via Yahoo by ISIN,
  -- crypto via CoinGecko by id. Insert only when not already seeded.
  insert into public.instruments (isin, symbol, name, type, currency, country, sector, region, quote_source, base_price, drift, vol, dividend_yield)
  select 'IE00B4L5Y983', null, 'iShares Core MSCI World UCITS ETF (Acc)', 'ETF', 'EUR', null, null, 'World', 'yahoo', 105, 0.08, 0.16, 0
  where not exists (select 1 from public.instruments where isin = 'IE00B4L5Y983');

  insert into public.instruments (isin, symbol, name, type, currency, country, sector, region, quote_source, base_price, drift, vol, dividend_yield)
  select 'US67066G1040', null, 'NVIDIA Corporation', 'STOCK', 'EUR', 'United States', 'Information Technology', 'North America', 'yahoo', 110, 0.15, 0.40, 0
  where not exists (select 1 from public.instruments where isin = 'US67066G1040');

  insert into public.instruments (isin, symbol, name, type, currency, country, sector, region, quote_source, base_price, drift, vol, dividend_yield)
  select 'IE00BKM4GZ66', null, 'iShares Core MSCI EM IMI UCITS ETF (Acc)', 'ETF', 'EUR', null, null, 'Emerging Markets', 'yahoo', 34, 0.07, 0.18, 0
  where not exists (select 1 from public.instruments where isin = 'IE00BKM4GZ66');

  insert into public.instruments (isin, symbol, name, type, currency, country, sector, region, quote_source, base_price, drift, vol, dividend_yield)
  select 'LU0908500753', null, 'Amundi Core MSCI World UCITS ETF (Acc)', 'ETF', 'EUR', null, null, 'World', 'yahoo', 24, 0.08, 0.16, 0
  where not exists (select 1 from public.instruments where isin = 'LU0908500753');

  insert into public.instruments (isin, symbol, name, type, currency, country, sector, region, quote_source, base_price, drift, vol, dividend_yield)
  select 'DE0009848119', null, 'DWS Top Dividende LD', 'ETF', 'EUR', null, 'Diversified', 'World', 'yahoo', 150, 0.06, 0.13, 0.03
  where not exists (select 1 from public.instruments where isin = 'DE0009848119');

  insert into public.instruments (isin, symbol, name, type, currency, country, sector, region, quote_source, base_price, drift, vol, dividend_yield)
  select 'LU0831568729', null, 'Flossbach von Storch Multiple Opportunities II R', 'ETF', 'EUR', null, 'Multi-Asset', 'World', 'yahoo', 270, 0.05, 0.10, 0
  where not exists (select 1 from public.instruments where isin = 'LU0831568729');

  insert into public.instruments (isin, symbol, name, type, currency, country, sector, region, quote_source, quote_id, base_price, drift, vol, dividend_yield)
  select null, 'BTC', 'Bitcoin', 'CRYPTO', 'EUR', null, null, 'Digital Assets', 'coingecko', 'bitcoin', 55000, 0.20, 0.70, 0
  where not exists (select 1 from public.instruments where symbol = 'BTC');

  insert into public.instruments (isin, symbol, name, type, currency, country, sector, region, quote_source, quote_id, base_price, drift, vol, dividend_yield)
  select null, 'ETH', 'Ethereum', 'CRYPTO', 'EUR', null, null, 'Digital Assets', 'coingecko', 'ethereum', 2800, 0.18, 0.80, 0
  where not exists (select 1 from public.instruments where symbol = 'ETH');

  -- Wipe the demo user's holdings (deleting assets/portfolios cascades to their
  -- transactions); the catalog is left intact.
  delete from public.assets where user_id = demo_user;
  delete from public.portfolios where user_id = demo_user;

  -- Portfolios.
  insert into public.portfolios (id, user_id, name) values
    ('5e123991-0000-4000-8000-000000000001', demo_user, 'Neobroker'),
    ('5e123991-0000-4000-8000-000000000002', demo_user, 'Bank'),
    ('5e123991-0000-4000-8000-000000000003', demo_user, 'Crypto');

  -- Assets (linked to the catalog by ISIN/symbol).
  insert into public.assets (id, user_id, instrument_id, currency) values
    ('5e123991-1111-4000-8000-000000000001', demo_user, (select id from public.instruments where isin = 'IE00B4L5Y983' order by created_at limit 1), 'EUR'),
    ('5e123991-1111-4000-8000-000000000002', demo_user, (select id from public.instruments where isin = 'US67066G1040' order by created_at limit 1), 'EUR'),
    ('5e123991-1111-4000-8000-000000000003', demo_user, (select id from public.instruments where isin = 'IE00BKM4GZ66' order by created_at limit 1), 'EUR'),
    ('5e123991-1111-4000-8000-000000000004', demo_user, (select id from public.instruments where isin = 'LU0908500753' order by created_at limit 1), 'EUR'),
    ('5e123991-1111-4000-8000-000000000005', demo_user, (select id from public.instruments where isin = 'DE0009848119' order by created_at limit 1), 'EUR'),
    ('5e123991-1111-4000-8000-000000000006', demo_user, (select id from public.instruments where isin = 'LU0831568729' order by created_at limit 1), 'EUR'),
    ('5e123991-1111-4000-8000-000000000007', demo_user, (select id from public.instruments where symbol = 'BTC' order by created_at limit 1), 'EUR'),
    ('5e123991-1111-4000-8000-000000000008', demo_user, (select id from public.instruments where symbol = 'ETH' order by created_at limit 1), 'EUR');

  -- Transactions. Core world ETFs dominate, EM is a smaller satellite, a single
  -- growth stock and crypto stay modest. A few sells take profits after strong
  -- runs (NVIDIA, BTC/ETH, a World-ETF trim).
  insert into public.transactions (id, asset_id, portfolio_id, type, quantity, price, fee, executed_at) values
    -- iShares Core MSCI World (Neobroker)
    ('5e123991-2222-4000-8000-000000000001', '5e123991-1111-4000-8000-000000000001', '5e123991-0000-4000-8000-000000000001', 'BUY',  60, 72,  1, '2023-02-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000002', '5e123991-1111-4000-8000-000000000001', '5e123991-0000-4000-8000-000000000001', 'BUY',  40, 80,  1, '2023-08-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000003', '5e123991-1111-4000-8000-000000000001', '5e123991-0000-4000-8000-000000000001', 'BUY',  40, 88,  1, '2024-03-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000004', '5e123991-1111-4000-8000-000000000001', '5e123991-0000-4000-8000-000000000001', 'BUY',  30, 95,  1, '2025-01-15 10:00:00'),
    ('5e123991-2222-4000-8000-000000000005', '5e123991-1111-4000-8000-000000000001', '5e123991-0000-4000-8000-000000000001', 'BUY',  20, 100, 1, '2025-09-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000006', '5e123991-1111-4000-8000-000000000001', '5e123991-0000-4000-8000-000000000001', 'SELL', 47, 104, 1, '2026-02-01 10:00:00'),
    -- NVIDIA (Neobroker)
    ('5e123991-2222-4000-8000-000000000007', '5e123991-1111-4000-8000-000000000002', '5e123991-0000-4000-8000-000000000001', 'BUY',  15, 48,  1, '2024-01-20 10:00:00'),
    ('5e123991-2222-4000-8000-000000000008', '5e123991-1111-4000-8000-000000000002', '5e123991-0000-4000-8000-000000000001', 'BUY',  12, 100, 1, '2024-09-10 10:00:00'),
    ('5e123991-2222-4000-8000-000000000009', '5e123991-1111-4000-8000-000000000002', '5e123991-0000-4000-8000-000000000001', 'BUY',  10, 95,  1, '2025-03-05 10:00:00'),
    ('5e123991-2222-4000-8000-000000000010', '5e123991-1111-4000-8000-000000000002', '5e123991-0000-4000-8000-000000000001', 'BUY',   8, 120, 1, '2025-11-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000011', '5e123991-1111-4000-8000-000000000002', '5e123991-0000-4000-8000-000000000001', 'SELL',  9, 130, 1, '2026-01-10 10:00:00'),
    -- iShares Core MSCI EM IMI (Neobroker)
    ('5e123991-2222-4000-8000-000000000012', '5e123991-1111-4000-8000-000000000003', '5e123991-0000-4000-8000-000000000001', 'BUY',  50, 28,  1, '2023-03-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000013', '5e123991-1111-4000-8000-000000000003', '5e123991-0000-4000-8000-000000000001', 'BUY',  40, 30,  1, '2024-01-10 10:00:00'),
    ('5e123991-2222-4000-8000-000000000014', '5e123991-1111-4000-8000-000000000003', '5e123991-0000-4000-8000-000000000001', 'BUY',  28, 32,  1, '2025-02-01 10:00:00'),
    -- Amundi Core MSCI World (Neobroker)
    ('5e123991-2222-4000-8000-000000000015', '5e123991-1111-4000-8000-000000000004', '5e123991-0000-4000-8000-000000000001', 'BUY', 120, 16.5, 1, '2023-05-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000016', '5e123991-1111-4000-8000-000000000004', '5e123991-0000-4000-8000-000000000001', 'BUY', 100, 19,   1, '2024-04-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000017', '5e123991-1111-4000-8000-000000000004', '5e123991-0000-4000-8000-000000000001', 'BUY',  72, 22,   1, '2025-05-01 10:00:00'),
    -- DWS Top Dividende (Bank)
    ('5e123991-2222-4000-8000-000000000018', '5e123991-1111-4000-8000-000000000005', '5e123991-0000-4000-8000-000000000002', 'BUY',  30, 132, 0, '2023-04-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000019', '5e123991-1111-4000-8000-000000000005', '5e123991-0000-4000-8000-000000000002', 'BUY',  20, 140, 0, '2024-06-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000020', '5e123991-1111-4000-8000-000000000005', '5e123991-0000-4000-8000-000000000002', 'BUY',  14, 150, 0, '2025-07-01 10:00:00'),
    -- Flossbach von Storch Multiple Opportunities (Bank)
    ('5e123991-2222-4000-8000-000000000021', '5e123991-1111-4000-8000-000000000006', '5e123991-0000-4000-8000-000000000002', 'BUY',  12, 235, 0, '2023-06-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000022', '5e123991-1111-4000-8000-000000000006', '5e123991-0000-4000-8000-000000000002', 'BUY',   6, 255, 0, '2024-09-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000023', '5e123991-1111-4000-8000-000000000006', '5e123991-0000-4000-8000-000000000002', 'BUY',   4, 265, 0, '2025-10-01 10:00:00'),
    -- Bitcoin (Crypto)
    ('5e123991-2222-4000-8000-000000000024', '5e123991-1111-4000-8000-000000000007', '5e123991-0000-4000-8000-000000000003', 'BUY',  0.03,   25000, 1, '2023-07-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000025', '5e123991-1111-4000-8000-000000000007', '5e123991-0000-4000-8000-000000000003', 'BUY',  0.025,  40000, 1, '2024-02-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000026', '5e123991-1111-4000-8000-000000000007', '5e123991-0000-4000-8000-000000000003', 'BUY',  0.02,   60000, 1, '2024-11-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000027', '5e123991-1111-4000-8000-000000000007', '5e123991-0000-4000-8000-000000000003', 'SELL', 0.0114, 90000, 1, '2025-12-01 10:00:00'),
    -- Ethereum (Crypto)
    ('5e123991-2222-4000-8000-000000000028', '5e123991-1111-4000-8000-000000000008', '5e123991-0000-4000-8000-000000000003', 'BUY',  0.3,   1700, 1, '2023-07-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000029', '5e123991-1111-4000-8000-000000000008', '5e123991-0000-4000-8000-000000000003', 'BUY',  0.2,   2900, 1, '2024-05-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000030', '5e123991-1111-4000-8000-000000000008', '5e123991-0000-4000-8000-000000000003', 'BUY',  0.15,  2400, 1, '2025-04-01 10:00:00'),
    ('5e123991-2222-4000-8000-000000000031', '5e123991-1111-4000-8000-000000000008', '5e123991-0000-4000-8000-000000000003', 'SELL', 0.114, 3500, 1, '2025-12-01 10:00:00');
end;
$func$;

-- 2. Schedule the nightly reset via Supabase pg_cron ------------------------
-- Runs at 03:00 UTC every day. Wrapped so the seed still applies if pg_cron is
-- unavailable (e.g. local dev) — you'd then just call the function manually.
do $cron$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'reset-demo-portfolio') then
    perform cron.unschedule('reset-demo-portfolio');
  end if;
  perform cron.schedule(
    'reset-demo-portfolio',
    '0 3 * * *',
    $$select public.reset_demo_portfolio();$$
  );
exception when others then
  raise notice 'pg_cron unavailable (%); nightly reset NOT scheduled. Enable pg_cron, or run "select public.reset_demo_portfolio();" yourself.', sqlerrm;
end
$cron$;

-- 3. Seed once now ----------------------------------------------------------
select public.reset_demo_portfolio();

-- Resulting net positions (buy-and-hold with a few trims):
--   Neobroker: World 143, NVIDIA 36, EM IMI 118, Amundi World 292
--   Bank:      DWS Top Dividende 64, Flossbach MO II 22
--   Crypto:    BTC ~0.0636, ETH ~0.536
