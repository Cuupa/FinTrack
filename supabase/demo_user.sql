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
demo_user uuid := '5a9dd013-2018-4415-9d29-7f5c24d52641';
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

-- Followed but not held, so the watchlist below has something to show that is
-- not already a position.
insert into public.instruments (isin, symbol, name, type, currency, country, sector, region, quote_source, base_price, drift, vol, dividend_yield)
select 'DE0007030009', null, 'Rheinmetall AG', 'STOCK', 'EUR', 'Germany', 'Industrials', 'Europe', 'yahoo', 480, 0.12, 0.35, 0.01
    where not exists (select 1 from public.instruments where isin = 'DE0007030009');

-- Wipe the demo user's own rows. Deleting assets/portfolios cascades to their
-- transactions, savings plans and tags; accounts and categories cascade to the
-- bookings, budgets and planned cashflows hanging off them. Goals and
-- contracts only SET NULL on those FKs, so they are deleted by hand or a
-- nightly reset would stack a second copy every night. The catalog is global
-- data and is left intact.
delete from public.goals where user_id = demo_user;
delete from public.contracts where user_id = demo_user;
delete from public.watchlist_items where user_id = demo_user;
delete from public.tag_groups where user_id = demo_user;
delete from public.pension_points where user_id = demo_user;
delete from public.pension_contracts where user_id = demo_user;
delete from public.accounts where user_id = demo_user;
delete from public.spending_categories where user_id = demo_user;
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

-- ---------------------------------------------------------------------------
-- Everyday money and planning.
--
-- The demo used to be a depot and nothing else, so /accounts, /cashflow,
-- /debt, /goals, /health, /fire and the pension page all opened empty on the
-- one account a visitor is meant to look around in.
--
-- Dates are derived from `current_date` rather than pinned, because this
-- function re-runs nightly: fixed dates would drift into "last year's demo"
-- and the health, FIRE and cash-flow pages all read a TRAILING window.

-- Accounts. A salary account, savings, a card, the flat and the loan against
-- it -- the last two are what let net worth be a real figure rather than just
-- the depot, and what gives /debt something to amortise.
insert into public.accounts (id, user_id, name, kind, currency, is_liability, opening_balance, opened_on) values
  ('5e123991-3333-4000-8000-000000000001', demo_user, 'Girokonto',        'checking',    'EUR', false,   2400, current_date - interval '4 years'),
  ('5e123991-3333-4000-8000-000000000002', demo_user, 'Tagesgeld',        'savings',     'EUR', false,  11500, current_date - interval '4 years'),
  ('5e123991-3333-4000-8000-000000000003', demo_user, 'Kreditkarte',      'credit',      'EUR', true,     320, current_date - interval '3 years'),
  ('5e123991-3333-4000-8000-000000000004', demo_user, 'Eigentumswohnung', 'other_asset', 'EUR', false, 320000, current_date - interval '3 years');

-- The loan carries a rate SCHEDULE, not one number: the fixed period runs out
-- and an assumed follow-up rate takes over, which is the whole point of the
-- /debt projection.
insert into public.accounts (id, user_id, name, kind, currency, is_liability, opening_balance, opened_on, interest_rate, min_payment, rate_fixed_until, follow_up_rate) values
  ('5e123991-3333-4000-8000-000000000005', demo_user, 'Immobilienkredit', 'mortgage', 'EUR', true, 240000, current_date - interval '3 years', 3.4, 1150, current_date + interval '7 years', 5.0);

-- Dated readings, so the balances move instead of sitting at the opening
-- figure forever. The loan pays down; the current account breathes.
insert into public.account_balances (user_id, account_id, balance_on, balance) values
  (demo_user, '5e123991-3333-4000-8000-000000000001', current_date - interval '12 months', 2650),
  (demo_user, '5e123991-3333-4000-8000-000000000001', current_date - interval '6 months',  3120),
  (demo_user, '5e123991-3333-4000-8000-000000000001', current_date,                        3480),
  (demo_user, '5e123991-3333-4000-8000-000000000002', current_date - interval '6 months',  13000),
  (demo_user, '5e123991-3333-4000-8000-000000000002', current_date,                        14200),
  (demo_user, '5e123991-3333-4000-8000-000000000003', current_date,                        410),
  (demo_user, '5e123991-3333-4000-8000-000000000005', current_date - interval '24 months', 228000),
  (demo_user, '5e123991-3333-4000-8000-000000000005', current_date - interval '12 months', 219500),
  (demo_user, '5e123991-3333-4000-8000-000000000005', current_date,                        210800);

-- Categories, grouped the way the manager groups them.
insert into public.spending_categories (id, user_id, group_name, name, tax_deductible) values
  ('5e123991-4444-4000-8000-000000000001', demo_user, 'Einkommen',      'Gehalt',        false),
  ('5e123991-4444-4000-8000-000000000002', demo_user, 'Wohnen',         'Nebenkosten',   false),
  ('5e123991-4444-4000-8000-000000000003', demo_user, 'Wohnen',         'Strom',         false),
  ('5e123991-4444-4000-8000-000000000004', demo_user, 'Lebenshaltung',  'Supermarkt',    false),
  ('5e123991-4444-4000-8000-000000000005', demo_user, 'Lebenshaltung',  'Restaurant',    false),
  ('5e123991-4444-4000-8000-000000000006', demo_user, 'Mobilität',      'Tanken',        false),
  ('5e123991-4444-4000-8000-000000000007', demo_user, 'Freizeit',       'Streaming',     false),
  ('5e123991-4444-4000-8000-000000000008', demo_user, 'Versicherung',   'Haftpflicht',   false),
  ('5e123991-4444-4000-8000-000000000009', demo_user, 'Arbeitsmittel',  'Fachliteratur', true);

-- 18 months of bookings, generated rather than typed out: the trailing-window
-- figures (safe-to-spend, the health gauges, the FIRE expense estimate) need a
-- year of history behind them to say anything at all. The small per-month
-- variation keeps the charts from being flat lines.
insert into public.spending_transactions (user_id, account_id, category_id, date, amount, payee)
select demo_user,
       '5e123991-3333-4000-8000-000000000001',
       c.category_id,
       (date_trunc('month', current_date) - (m || ' months')::interval + (c.day - 1) * interval '1 day')::date,
       -- A fixed monthly figure (the salary, wobble 0) must stay exactly the
       -- figure the planned cashflow below promises, or /cashflow reads as
       -- permanently off by the wobble.
       c.amount + case when c.wobble = 0 then 0 else ((m * c.wobble) % 41) - 20 end,
       c.payee
  from generate_series(0, 17) as m
  cross join (values
    ('5e123991-4444-4000-8000-000000000001'::uuid,  3450, 'Arbeitgeber',   0,  7),
    ('5e123991-4444-4000-8000-000000000002'::uuid,  -285, 'Hausverwaltung', 1,  3),
    ('5e123991-4444-4000-8000-000000000003'::uuid,   -96, 'Stadtwerke',     2,  5),
    ('5e123991-4444-4000-8000-000000000004'::uuid,  -430, 'Supermarkt',    11, 13),
    ('5e123991-4444-4000-8000-000000000005'::uuid,   -95, 'Restaurant',    18, 17),
    ('5e123991-4444-4000-8000-000000000006'::uuid,  -110, 'Tankstelle',     8, 11)
  ) as c(category_id, amount, payee, wobble, day)
 where (date_trunc('month', current_date) - (m || ' months')::interval + (c.day - 1) * interval '1 day')::date <= current_date;

-- The mortgage payment is a TRANSFER onto the loan, not consumption: it must
-- not read as an expense, and it has to land on the liability so the payoff
-- projection sees it.
insert into public.spending_transactions (user_id, account_id, category_id, date, amount, payee, transfer_account_id)
select demo_user,
       '5e123991-3333-4000-8000-000000000001',
       null,
       (date_trunc('month', current_date) - (m || ' months')::interval)::date,
       -1150,
       'Immobilienkredit Rate',
       '5e123991-3333-4000-8000-000000000005'
  from generate_series(0, 17) as m;

-- Caps on the two categories that actually move month to month.
insert into public.budgets (user_id, category_id, amount) values
  (demo_user, '5e123991-4444-4000-8000-000000000004', 450),
  (demo_user, '5e123991-4444-4000-8000-000000000005', 120),
  (demo_user, '5e123991-4444-4000-8000-000000000007', 30);

-- Recurring commitments. The insurance is annual on purpose, so the register
-- has something that is not simply "x per month".
insert into public.contracts (user_id, name, amount, interval, renewal_date, cancellation_notice_days, category_id, account_id, booking_start_date) values
  (demo_user, 'Streaming',            12.99, 'MONTHLY', null,                            null, '5e123991-4444-4000-8000-000000000007', '5e123991-3333-4000-8000-000000000001', (current_date - interval '18 months')::date),
  (demo_user, 'Mobilfunk',            24.99, 'MONTHLY', null,                            null, null,                                    '5e123991-3333-4000-8000-000000000001', (current_date - interval '18 months')::date),
  (demo_user, 'Haftpflichtversicherung', 89, 'ANNUAL',  (current_date + interval '5 months')::date, 90, '5e123991-4444-4000-8000-000000000008', '5e123991-3333-4000-8000-000000000001', (current_date - interval '18 months')::date);

-- Planned income and expenses: what is EXPECTED, feeding /cashflow's forecast.
insert into public.planned_cashflows (user_id, name, account_id, category_id, amount, interval, start_date) values
  (demo_user, 'Gehalt',      '5e123991-3333-4000-8000-000000000001', '5e123991-4444-4000-8000-000000000001',  3450, 'MONTHLY', (current_date - interval '18 months')::date),
  (demo_user, 'Nebenkosten', '5e123991-3333-4000-8000-000000000001', '5e123991-4444-4000-8000-000000000002',  -285, 'MONTHLY', (current_date - interval '18 months')::date),
  (demo_user, 'Urlaub',      '5e123991-3333-4000-8000-000000000001', null,                                   -1800, 'ANNUAL',  (current_date - interval '10 months')::date);

-- Goals: one linked to a real account, one composite split into its parts
-- (whose target and progress are DERIVED from the children), and one tracking
-- the depot. The loan payoff goal is derived by the app itself and is
-- deliberately NOT seeded here.
insert into public.goals (id, user_id, name, target_amount, target_date, linked_account_id, tracks_investments) values
  ('5e123991-5555-4000-8000-000000000001', demo_user, 'Notgroschen', 18000, null, '5e123991-3333-4000-8000-000000000002', false),
  ('5e123991-5555-4000-8000-000000000002', demo_user, 'Weltreise',    9000, (current_date + interval '2 years')::date, null, false),
  ('5e123991-5555-4000-8000-000000000003', demo_user, 'Depot 100k',  100000, null, null, true);
insert into public.goals (id, user_id, name, target_amount, target_date, manual_current_amount, parent_goal_id) values
  ('5e123991-5555-4000-8000-000000000005', demo_user, 'Flüge',       2800, null, 900,  '5e123991-5555-4000-8000-000000000002'),
  ('5e123991-5555-4000-8000-000000000006', demo_user, 'Unterkunft',  4200, null, 1400, '5e123991-5555-4000-8000-000000000002'),
  ('5e123991-5555-4000-8000-000000000007', demo_user, 'Vor Ort',     2000, null, 300,  '5e123991-5555-4000-8000-000000000002');

-- A running savings plan, so the dashboard card and the FIRE contribution
-- estimate have a real monthly figure instead of zero.
insert into public.savings_plans (user_id, asset_id, portfolio_id, amount, frequency, start_date, active, last_run_date) values
  (demo_user, '5e123991-1111-4000-8000-000000000001', '5e123991-0000-4000-8000-000000000001', 500, 'MONTHLY', (current_date - interval '2 years')::date, true, date_trunc('month', current_date)::date),
  (demo_user, '5e123991-1111-4000-8000-000000000003', '5e123991-0000-4000-8000-000000000001', 150, 'MONTHLY', (current_date - interval '1 year')::date,  true, date_trunc('month', current_date)::date);

-- Followed, not held.
insert into public.watchlist_items (user_id, instrument_id, currency)
select demo_user, id, 'EUR' from public.instruments where isin = 'DE0007030009' order by created_at limit 1;

-- Tags: one group over every holding, so the Analysis "Custom" breakdown has
-- something to slice and nothing lands in the "Untagged" bucket by accident.
insert into public.tag_groups (id, user_id, name) values
  ('5e123991-6666-4000-8000-000000000001', demo_user, 'Strategie');
insert into public.asset_tags (user_id, asset_id, group_id, value) values
  (demo_user, '5e123991-1111-4000-8000-000000000001', '5e123991-6666-4000-8000-000000000001', 'Kern'),
  (demo_user, '5e123991-1111-4000-8000-000000000004', '5e123991-6666-4000-8000-000000000001', 'Kern'),
  (demo_user, '5e123991-1111-4000-8000-000000000002', '5e123991-6666-4000-8000-000000000001', 'Satellit'),
  (demo_user, '5e123991-1111-4000-8000-000000000003', '5e123991-6666-4000-8000-000000000001', 'Satellit'),
  (demo_user, '5e123991-1111-4000-8000-000000000007', '5e123991-6666-4000-8000-000000000001', 'Spekulation'),
  (demo_user, '5e123991-1111-4000-8000-000000000008', '5e123991-6666-4000-8000-000000000001', 'Spekulation');

-- Retirement. The birth year is what lets the projection extrapolate at all;
-- without it the page honestly reports only the entitlement earned so far.
update public.profiles
   set pension_settings = jsonb_build_object(
         'birthYear', 1990,
         'retirementAge', 67,
         'annualPoints', null,
         'targetMonthly', 2200,
         'totalPoints', null,
         'totalPointsYear', null)
 where id = demo_user;

insert into public.pension_points (user_id, year, points)
select demo_user, y, round((0.95 + (y % 5) * 0.06)::numeric, 4)
  from generate_series(extract(year from current_date)::int - 12, extract(year from current_date)::int - 1) as y;

insert into public.pension_contracts (user_id, name, kind, provider, monthly_contribution, current_value, expected_monthly_pension, starts_on) values
  (demo_user, 'Riester-Rente',        'riester',      'Allianz',     175, 21400, 240, make_date(1990 + 67, 1, 1)),
  (demo_user, 'Betriebliche Vorsorge', 'occupational', 'Arbeitgeber', 120, 14800, 165, make_date(1990 + 67, 1, 1));
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
--
-- Plus, since the everyday-money block: 5 accounts (incl. a flat and the loan
-- against it), 18 months of bookings across 9 categories, 3 budgets, 3
-- recurring payments, 3 planned cashflows, a composite goal with 3 parts plus
-- two atomic ones, 2 savings plans, a watchlist entry, one tag group over
-- every holding, 12 years of pension points and 2 policies.
--
-- The seed depends on the columns migrations 0102/0104/0113 add
-- (accounts.rate_fixed_until / follow_up_rate / min_payment, the month_end
-- columns). Against a database that has not run them the accounts insert
-- fails; run the migrations first, exactly as LEDGER.md tracks.
