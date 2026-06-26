-- Migration: ETF/fund constituents for look-through ("X-ray") analysis.
-- Stores which stocks (and weights) make up each fund. Idempotent.
--
-- Weights are approximate, representative top holdings — enough to show the
-- look-through exposure (e.g. how much NVIDIA you hold across several ETFs).

create table if not exists public.instrument_constituents (
  id uuid primary key default gen_random_uuid(),
  -- The ETF/fund, by its catalog symbol.
  etf_symbol text not null,
  constituent_name text not null,
  constituent_symbol text,
  constituent_isin text,
  -- Fraction of the fund (0..1).
  weight numeric not null check (weight >= 0 and weight <= 1),
  created_at timestamptz not null default now()
);
create index if not exists constituents_etf_idx
  on public.instrument_constituents (etf_symbol);
create unique index if not exists constituents_unique
  on public.instrument_constituents (etf_symbol, constituent_name);

alter table public.instrument_constituents enable row level security;
drop policy if exists "constituents readable" on public.instrument_constituents;
create policy "constituents readable"
  on public.instrument_constituents for select using (true);

-- Seed approximate top holdings (idempotent via the unique index). -----------
-- SPY — S&P 500
insert into public.instrument_constituents
  (etf_symbol, constituent_name, constituent_symbol, constituent_isin, weight)
values
  ('SPY', 'Apple Inc.',            'AAPL', 'US0378331005', 0.070),
  ('SPY', 'Microsoft Corp.',       'MSFT', 'US5949181045', 0.065),
  ('SPY', 'NVIDIA Corp.',          'NVDA', 'US67066G1040', 0.062),
  ('SPY', 'Amazon.com Inc.',       'AMZN', 'US0231351067', 0.038),
  ('SPY', 'Meta Platforms Inc.',   'META', 'US30303M1027', 0.024),
  ('SPY', 'Alphabet Inc. A',       'GOOGL','US02079K3059', 0.022),
  ('SPY', 'Tesla Inc.',            'TSLA', 'US88160R1014', 0.015),
  ('SPY', 'Broadcom Inc.',         'AVGO', 'US11135F1012', 0.015)
on conflict (etf_symbol, constituent_name) do nothing;

-- IWDA — iShares Core MSCI World
insert into public.instrument_constituents
  (etf_symbol, constituent_name, constituent_symbol, constituent_isin, weight)
values
  ('IWDA', 'Apple Inc.',          'AAPL', 'US0378331005', 0.050),
  ('IWDA', 'Microsoft Corp.',     'MSFT', 'US5949181045', 0.047),
  ('IWDA', 'NVIDIA Corp.',        'NVDA', 'US67066G1040', 0.045),
  ('IWDA', 'Amazon.com Inc.',     'AMZN', 'US0231351067', 0.027),
  ('IWDA', 'Meta Platforms Inc.', 'META', 'US30303M1027', 0.017),
  ('IWDA', 'Alphabet Inc. A',     'GOOGL','US02079K3059', 0.016)
on conflict (etf_symbol, constituent_name) do nothing;

-- VWCE — Vanguard FTSE All-World (similar mega-caps, slightly lower weights)
insert into public.instrument_constituents
  (etf_symbol, constituent_name, constituent_symbol, constituent_isin, weight)
values
  ('VWCE', 'Apple Inc.',          'AAPL', 'US0378331005', 0.043),
  ('VWCE', 'Microsoft Corp.',     'MSFT', 'US5949181045', 0.040),
  ('VWCE', 'NVIDIA Corp.',        'NVDA', 'US67066G1040', 0.039),
  ('VWCE', 'Amazon.com Inc.',     'AMZN', 'US0231351067', 0.023),
  ('VWCE', 'Meta Platforms Inc.', 'META', 'US30303M1027', 0.014),
  ('VWCE', 'Alphabet Inc. A',     'GOOGL','US02079K3059', 0.013)
on conflict (etf_symbol, constituent_name) do nothing;
