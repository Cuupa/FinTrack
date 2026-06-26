-- FinTrack Supabase schema (Registered Mode, PRD §5.2).
--
-- Run in the Supabase SQL editor (or `supabase db push`). Implements the PRD
-- data model with one pragmatic simplification: manually-entered assets and
-- the per-user mapping (`user_assets`) are merged into a single user-scoped
-- `assets` table (carrying `notes`), which is how hand-entered holdings are
-- normally modelled. Row-level security scopes every row to its owner.

-- Profiles -------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  currency text not null default 'EUR',
  created_at timestamptz not null default now()
);

-- Instruments catalog --------------------------------------------------------
-- Global reference data (the known assets + provider quote symbols). Source of
-- truth for auto-import and live-quote lookups; seeded in instruments_seed.sql.
create table if not exists public.instruments (
  id uuid primary key default gen_random_uuid(),
  -- null = global catalog; set = a user's custom (non-catalog) instrument.
  owner uuid references auth.users (id) on delete cascade,
  isin text,
  wkn text,
  symbol text,
  name text not null,
  type text not null check (type in ('ETF', 'STOCK', 'CRYPTO', 'CASH')),
  currency text,
  country text,
  quote_source text check (quote_source in ('yahoo', 'stooq', 'coingecko')),
  quote_id text,
  base_price numeric not null default 100,
  drift numeric not null default 0.07,
  vol numeric not null default 0.2,
  dividend_yield numeric not null default 0,
  dividend_synced_at timestamptz,
  -- Live price cached by the price-sync cron (see /api/cron/sync-prices).
  last_price numeric,
  price_synced_at timestamptz,
  created_at timestamptz not null default now()
);
-- Symbol uniqueness applies to the global catalog only.
create unique index if not exists instruments_symbol_key
  on public.instruments (symbol) where symbol is not null and owner is null;
create index if not exists instruments_isin_idx on public.instruments (isin);
create index if not exists instruments_wkn_idx on public.instruments (wkn);

-- ETF/fund constituents for look-through ("X-ray") analysis.
create table if not exists public.instrument_constituents (
  id uuid primary key default gen_random_uuid(),
  etf_symbol text not null,
  constituent_name text not null,
  constituent_symbol text,
  constituent_isin text,
  weight numeric not null check (weight >= 0 and weight <= 1),
  created_at timestamptz not null default now()
);
create index if not exists constituents_etf_idx
  on public.instrument_constituents (etf_symbol);
create unique index if not exists constituents_unique
  on public.instrument_constituents (etf_symbol, constituent_name);

-- FX rates anchored to EUR (units of `currency` per 1 EUR), cached by the cron.
create table if not exists public.fx_rates (
  currency text primary key,
  rate numeric not null,
  synced_at timestamptz not null default now()
);

-- Assets ---------------------------------------------------------------------
-- A user's holding: a link to an instrument (master data) plus user notes.
-- Master data (isin/wkn/symbol/name/type/currency) lives on the instrument.
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid not null references public.instruments (id),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists assets_user_id_idx on public.assets (user_id);
create index if not exists assets_instrument_id_idx on public.assets (instrument_id);

-- Transactions ---------------------------------------------------------------
-- No user_id: ownership is derived via the asset (3NF — avoids the transitive
-- dependency id -> asset_id -> user_id).
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  type text not null check (type in ('BUY', 'SELL')),
  quantity numeric not null check (quantity > 0),
  price numeric not null check (price >= 0),
  fee numeric not null default 0 check (fee >= 0),
  -- Trade date + time of day as a floating wall-clock (no time zone) — what
  -- the user picked, shown verbatim; avoids UTC reinterpretation/shifting.
  executed_at timestamp not null,
  created_at timestamptz not null default now()
);
create index if not exists transactions_asset_id_idx on public.transactions (asset_id);

-- Row-level security ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.assets enable row level security;
alter table public.transactions enable row level security;
alter table public.instruments enable row level security;
alter table public.instrument_constituents enable row level security;
alter table public.fx_rates enable row level security;

-- Catalog: the global rows (owner is null) are world-readable; a user can also
-- read and write their own custom instruments (owner = them).
drop policy if exists "instruments readable" on public.instruments;
create policy "instruments readable" on public.instruments
  for select using (owner is null or owner = auth.uid());
drop policy if exists "own instruments write" on public.instruments;
create policy "own instruments write" on public.instruments
  for all using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "constituents readable" on public.instrument_constituents;
create policy "constituents readable"
  on public.instrument_constituents for select using (true);
drop policy if exists "fx readable" on public.fx_rates;
create policy "fx readable" on public.fx_rates for select using (true);

-- `create policy` has no IF NOT EXISTS, so drop-then-create stays idempotent.
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own assets" on public.assets;
create policy "own assets" on public.assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Transactions are owned via their asset (no user_id column).
drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions for all
  using (asset_id in (select id from public.assets where user_id = auth.uid()))
  with check (asset_id in (select id from public.assets where user_id = auth.uid()));

-- Auto-create a profile row when a new auth user signs up --------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Seed the instruments catalog -----------------------------------------------
insert into public.instruments
  (isin, wkn, symbol, name, type, currency, country, quote_source, quote_id, base_price, drift, vol, dividend_yield)
values
  ('US0378331005', '865985', 'AAPL', 'Apple Inc.',               'STOCK',  'USD', 'United States', 'yahoo',     'AAPL',    230,   0.12, 0.28, 0.005),
  ('US5949181045', '870747', 'MSFT', 'Microsoft Corp.',          'STOCK',  'USD', 'United States', 'yahoo',     'MSFT',    430,   0.13, 0.26, 0.008),
  ('US67066G1040', '918422', 'NVDA', 'NVIDIA Corp.',             'STOCK',  'USD', 'United States', 'yahoo',     'NVDA',    125,   0.25, 0.45, 0.0003),
  ('US0231351067', '906866', 'AMZN', 'Amazon.com Inc.',          'STOCK',  'USD', 'United States', 'yahoo',     'AMZN',    185,   0.14, 0.32, 0),
  ('US88160R1014', 'A1CX3T', 'TSLA', 'Tesla Inc.',               'STOCK',  'USD', 'United States', 'yahoo',     'TSLA',    250,   0.18, 0.55, 0),
  ('US78462F1030', 'A0AET0', 'SPY',  'SPDR S&P 500 ETF',         'ETF',    'USD', 'United States', 'yahoo',     'SPY',     600,   0.09, 0.17, 0.013),
  ('IE00BK5BQT80', 'A2PKXG', 'VWCE', 'Vanguard FTSE All-World',  'ETF',    'EUR', 'Global',        'yahoo',     'VWCE.DE', 150,   0.08, 0.16, 0.018),
  ('IE00B4L5Y983', 'A0RPWH', 'IWDA', 'iShares Core MSCI World',  'ETF',    'EUR', 'Global',        'yahoo',     'IWDA.AS', 110,   0.08, 0.15, 0.017),
  (null,           null,     'BTC',  'Bitcoin',                  'CRYPTO', 'USD', 'Crypto',        'coingecko', 'bitcoin', 64000, 0.35, 0.7, 0),
  (null,           null,     'ETH',  'Ethereum',                 'CRYPTO', 'USD', 'Crypto',        'coingecko', 'ethereum', 3400, 0.30, 0.8, 0),
  (null,           null,     'SOL',  'Solana',                   'CRYPTO', 'USD', 'Crypto',        'coingecko', 'solana',  150,   0.40, 1.0, 0)
on conflict (symbol) where symbol is not null and owner is null do nothing;

-- Seed approximate FX rates (units per 1 EUR); the cron refreshes them.
insert into public.fx_rates (currency, rate) values
  ('EUR', 1), ('USD', 1.08), ('GBP', 0.85), ('CHF', 0.95),
  ('JPY', 170), ('CAD', 1.47), ('AUD', 1.63)
on conflict (currency) do nothing;

-- Seed ETF constituents (approximate top holdings) ---------------------------
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
  ('SPY', 'Broadcom Inc.',         'AVGO', 'US11135F1012', 0.015),
  ('IWDA', 'Apple Inc.',          'AAPL', 'US0378331005', 0.050),
  ('IWDA', 'Microsoft Corp.',     'MSFT', 'US5949181045', 0.047),
  ('IWDA', 'NVIDIA Corp.',        'NVDA', 'US67066G1040', 0.045),
  ('IWDA', 'Amazon.com Inc.',     'AMZN', 'US0231351067', 0.027),
  ('IWDA', 'Meta Platforms Inc.', 'META', 'US30303M1027', 0.017),
  ('IWDA', 'Alphabet Inc. A',     'GOOGL','US02079K3059', 0.016),
  ('VWCE', 'Apple Inc.',          'AAPL', 'US0378331005', 0.043),
  ('VWCE', 'Microsoft Corp.',     'MSFT', 'US5949181045', 0.040),
  ('VWCE', 'NVIDIA Corp.',        'NVDA', 'US67066G1040', 0.039),
  ('VWCE', 'Amazon.com Inc.',     'AMZN', 'US0231351067', 0.023),
  ('VWCE', 'Meta Platforms Inc.', 'META', 'US30303M1027', 0.014),
  ('VWCE', 'Alphabet Inc. A',     'GOOGL','US02079K3059', 0.013)
on conflict (etf_symbol, constituent_name) do nothing;
