-- Migration: add country (for allocation breakdowns) and dividend yield (so
-- dividend data lives in the DB, not in code) to the instruments catalog.
-- Also adds a sync timestamp so a future API job can refresh yields and detect
-- changes. Idempotent.

alter table public.instruments add column if not exists country text;
alter table public.instruments add column if not exists dividend_yield numeric not null default 0;
alter table public.instruments add column if not exists dividend_synced_at timestamptz;

-- Backfill reference data for the seeded instruments.
update public.instruments set country = case
    when symbol in ('AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA', 'SPY') then 'United States'
    when symbol in ('VWCE', 'IWDA') then 'Global'
    when symbol in ('BTC', 'ETH', 'SOL') then 'Crypto'
    else country
  end
  where country is null;

update public.instruments set dividend_yield = case symbol
    when 'AAPL' then 0.005
    when 'MSFT' then 0.008
    when 'NVDA' then 0.0003
    when 'SPY'  then 0.013
    when 'VWCE' then 0.018
    when 'IWDA' then 0.017
    else 0
  end
  where symbol is not null and dividend_yield = 0;

-- Refresh stale synthetic anchor prices toward current levels.
update public.instruments set base_price = 150 where symbol = 'VWCE';
update public.instruments set base_price = 110 where symbol = 'IWDA';
update public.instruments set base_price = 600 where symbol = 'SPY';
