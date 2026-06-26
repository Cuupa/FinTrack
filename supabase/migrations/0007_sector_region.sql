-- Migration: add sector + geographic region classifications for look-through
-- allocation (Analysis → Sectors / Region). Idempotent. Classifications live on
-- instruments (direct holdings) and instrument_constituents (ETF look-through);
-- unknowns can be enriched online via /api/classify.

alter table public.instruments add column if not exists sector text;
alter table public.instruments add column if not exists region text;
alter table public.instrument_constituents add column if not exists sector text;
alter table public.instrument_constituents add column if not exists region text;

-- Direct-holding instruments (stocks + crypto).
update public.instruments set sector = 'Information Technology', region = 'North America'
  where symbol in ('AAPL', 'MSFT', 'NVDA');
update public.instruments set sector = 'Consumer Discretionary', region = 'North America'
  where symbol in ('AMZN', 'TSLA');
update public.instruments set sector = 'Digital Assets', region = 'Crypto'
  where type = 'CRYPTO';

-- ETF constituents.
update public.instrument_constituents set sector = 'Information Technology', region = 'North America'
  where constituent_symbol in ('AAPL', 'MSFT', 'NVDA', 'AVGO');
update public.instrument_constituents set sector = 'Consumer Discretionary', region = 'North America'
  where constituent_symbol in ('AMZN', 'TSLA');
update public.instrument_constituents set sector = 'Communication Services', region = 'North America'
  where constituent_symbol in ('META', 'GOOGL');
