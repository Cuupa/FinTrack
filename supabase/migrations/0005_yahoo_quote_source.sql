-- Migration: point equity instruments at Yahoo Finance explicitly. Yahoo is
-- resolved by ISIN (with currency matching) in /api/quotes; quote_id holds a
-- Yahoo symbol hint to skip the search step. Idempotent.

-- Allow 'yahoo' as a quote source.
alter table public.instruments drop constraint if exists instruments_quote_source_check;
alter table public.instruments
  add constraint instruments_quote_source_check
  check (quote_source in ('yahoo', 'stooq', 'coingecko'));

-- Repoint the seeded stocks/ETFs from Stooq to Yahoo, with Yahoo symbol hints.
update public.instruments set quote_source = 'yahoo', quote_id = case symbol
    when 'AAPL' then 'AAPL'
    when 'MSFT' then 'MSFT'
    when 'NVDA' then 'NVDA'
    when 'AMZN' then 'AMZN'
    when 'TSLA' then 'TSLA'
    when 'SPY'  then 'SPY'
    when 'VWCE' then 'VWCE.DE'
    when 'IWDA' then 'IWDA.AS'
    else quote_id
  end
  where type in ('STOCK', 'ETF');
