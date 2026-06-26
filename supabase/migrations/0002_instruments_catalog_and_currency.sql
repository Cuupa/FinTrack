-- Migration: move the asset catalog into the database (instruments table) and
-- add a native currency to user assets for multi-currency support. Idempotent.

-- Instruments catalog --------------------------------------------------------
-- Global reference data: the known assets (BTC, AAPL, VWCE …) and the provider
-- symbols used to fetch live quotes. Replaces the former in-code registry.
create table if not exists public.instruments (
  id uuid primary key default gen_random_uuid(),
  isin text,
  wkn text,
  symbol text,
  name text not null,
  type text not null check (type in ('ETF', 'STOCK', 'CRYPTO', 'CASH')),
  -- Native trading currency; null means "base currency" (used for crypto,
  -- which we quote directly in the user's base currency).
  currency text,
  -- Remote quote provider + that provider's symbol/id.
  quote_source text check (quote_source in ('stooq', 'coingecko')),
  quote_id text,
  -- Parameters for the synthetic price fallback (offline / unknown).
  base_price numeric not null default 100,
  drift numeric not null default 0.07,
  vol numeric not null default 0.2,
  created_at timestamptz not null default now()
);

create unique index if not exists instruments_symbol_key
  on public.instruments (symbol) where symbol is not null;
create index if not exists instruments_isin_idx on public.instruments (isin);
create index if not exists instruments_wkn_idx on public.instruments (wkn);

-- Catalog is public reference data: readable by everyone, writable by no one
-- (seeded via SQL / service role).
alter table public.instruments enable row level security;
drop policy if exists "instruments readable" on public.instruments;
create policy "instruments readable" on public.instruments for select using (true);

-- Seed the known instruments. on conflict keeps it idempotent.
insert into public.instruments
  (isin, wkn, symbol, name, type, currency, quote_source, quote_id, base_price, drift, vol)
values
  ('US0378331005', '865985', 'AAPL', 'Apple Inc.',               'STOCK',  'USD', 'stooq',     'aapl.us', 210,   0.12, 0.28),
  ('US5949181045', '870747', 'MSFT', 'Microsoft Corp.',          'STOCK',  'USD', 'stooq',     'msft.us', 430,   0.13, 0.26),
  ('US67066G1040', '918422', 'NVDA', 'NVIDIA Corp.',             'STOCK',  'USD', 'stooq',     'nvda.us', 125,   0.25, 0.45),
  ('US0231351067', '906866', 'AMZN', 'Amazon.com Inc.',          'STOCK',  'USD', 'stooq',     'amzn.us', 185,   0.14, 0.32),
  ('US88160R1014', 'A1CX3T', 'TSLA', 'Tesla Inc.',               'STOCK',  'USD', 'stooq',     'tsla.us', 250,   0.18, 0.55),
  ('US78462F1030', 'A0AET0', 'SPY',  'SPDR S&P 500 ETF',         'ETF',    'USD', 'stooq',     'spy.us',  555,   0.09, 0.17),
  ('IE00BK5BQT80', 'A2PKXG', 'VWCE', 'Vanguard FTSE All-World',  'ETF',    'EUR', 'stooq',     'vwce.de', 118,   0.08, 0.16),
  ('IE00B4L5Y983', 'A0RPWH', 'IWDA', 'iShares Core MSCI World',  'ETF',    'EUR', 'stooq',     'iwda.nl', 95,    0.08, 0.15),
  (null,           null,     'BTC',  'Bitcoin',                  'CRYPTO', null,  'coingecko', 'bitcoin', 64000, 0.35, 0.7),
  (null,           null,     'ETH',  'Ethereum',                 'CRYPTO', null,  'coingecko', 'ethereum', 3400, 0.30, 0.8),
  (null,           null,     'SOL',  'Solana',                   'CRYPTO', null,  'coingecko', 'solana',  150,   0.40, 1.0)
on conflict (symbol) where symbol is not null do nothing;

-- User assets: native currency -----------------------------------------------
-- null means the portfolio base currency.
alter table public.assets add column if not exists currency text;
