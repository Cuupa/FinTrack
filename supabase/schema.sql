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
  isin text,
  wkn text,
  symbol text,
  name text not null,
  type text not null check (type in ('ETF', 'STOCK', 'CRYPTO', 'CASH')),
  currency text,
  country text,
  sector text,
  region text,
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
-- Symbol uniqueness across the (global) instruments catalog.
create unique index if not exists instruments_symbol_key
  on public.instruments (symbol) where symbol is not null;
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
  sector text,
  region text,
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
  -- The currency THIS user trades the instrument in (e.g. the EUR Xetra line of
  -- a USD-listed stock). Per-holding; null falls back to the instrument's. The
  -- shared instrument is never mutated by a user's currency choice.
  currency text,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.assets add column if not exists currency text;
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

-- Catalog: instruments are global reference data — world-readable, and any
-- authenticated user may add a new one (the catalog grows as people import
-- assets). Updates/deletes are service-role only (the price-sync cron), which
-- bypasses RLS; clients never mutate shared rows.
drop policy if exists "instruments readable" on public.instruments;
create policy "instruments readable" on public.instruments
  for select using (true);
drop policy if exists "own instruments write" on public.instruments;
drop policy if exists "instruments insertable" on public.instruments;
create policy "instruments insertable" on public.instruments
  for insert to authenticated with check (true);
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
on conflict (symbol) where symbol is not null do nothing;

-- Seed approximate FX rates (units per 1 EUR); the cron refreshes them.
insert into public.fx_rates (currency, rate) values
  ('EUR', 1), ('USD', 1.08), ('GBP', 0.85), ('CHF', 0.95),
  ('JPY', 170), ('CAD', 1.47), ('AUD', 1.63)
on conflict (currency) do nothing;

-- Seed ETF constituents (approximate top holdings) ---------------------------
insert into public.instrument_constituents
  (etf_symbol, constituent_name, constituent_symbol, constituent_isin, weight)
values
  ('SPY', 'NVIDIA Corp', 'NVDA', 'US67066G1040', 0.0697),
  ('SPY', 'Apple Inc', 'AAPL', 'US0378331005', 0.062),
  ('SPY', 'Microsoft Corp', 'MSFT', 'US5949181045', 0.0413),
  ('SPY', 'Amazon.com Inc', 'AMZN', 'US0231351067', 0.0374),
  ('SPY', 'Alphabet Inc', 'GOOGL', 'US02079K3059', 0.0319),
  ('SPY', 'Alphabet Inc (GOOG)', 'GOOG', 'US02079K1079', 0.0297),
  ('SPY', 'Broadcom Inc', 'AVGO', 'US11135F1012', 0.026),
  ('SPY', 'Tesla Inc', 'TSLA', 'US88160R1014', 0.0212),
  ('SPY', 'Meta Platforms Inc', 'META', 'US30303M1027', 0.0209),
  ('SPY', 'Micron Technology Inc', 'MU', null, 0.019),
  ('SPY', 'Eli Lilly &amp; Co', 'LLY', 'US5324571083', 0.0161),
  ('SPY', 'Berkshire Hathaway Inc', 'BRK.B', 'US0846707026', 0.016),
  ('SPY', 'Walmart Inc', 'WMT', 'US9311421039', 0.0138),
  ('SPY', 'JPMorgan Chase &amp; Co', 'JPM', 'US46625H1005', 0.0132),
  ('SPY', 'Advanced Micro Devices Inc', 'AMD', 'US0079031078', 0.0126),
  ('SPY', 'Visa Inc', 'V', 'US92826C8394', 0.0096),
  ('SPY', 'Intel Corp', 'INTC', null, 0.0096),
  ('SPY', 'Johnson &amp; Johnson', 'JNJ', 'US4781601046', 0.0091),
  ('SPY', 'Exxon Mobil Corp', 'XOM', 'US30231G1022', 0.0085),
  ('SPY', 'Applied Materials Inc', 'AMAT', null, 0.0074),
  ('SPY', 'Lam Research Corp', 'LRCX', null, 0.0071),
  ('SPY', 'Caterpillar Inc', 'CAT', null, 0.0069),
  ('SPY', 'Cisco Systems Inc', 'CSCO', null, 0.0067),
  ('SPY', 'AbbVie Inc', 'ABBV', 'US00287Y1091', 0.0067),
  ('SPY', 'Mastercard Inc', 'MA', 'US57636Q1040', 0.0066),
  ('SPY', 'Oracle Corp', 'ORCL', 'US68389X1054', 0.0064),
  ('SPY', 'Costco Wholesale Corp', 'COST', 'US22160K1051', 0.0063),
  ('SPY', 'Bank of America Corp', 'BAC', 'US0605051046', 0.0061),
  ('SPY', 'UnitedHealth Group Inc', 'UNH', 'US91324P1021', 0.0058),
  ('SPY', 'General Electric Co', 'GE', null, 0.0058),
  ('SPY', 'Coca-Cola Co/The', 'KO', 'US1912161007', 0.0053),
  ('SPY', 'Procter &amp; Gamble Co/The', 'PG', 'US7427181091', 0.0052),
  ('SPY', 'Home Depot Inc/The', 'HD', 'US4370761029', 0.0052),
  ('SPY', 'Chevron Corp', 'CVX', 'US1667641005', 0.0051),
  ('SPY', 'Morgan Stanley', 'MS', null, 0.005),
  ('SPY', 'KLA Corp', 'KLAC', null, 0.0048),
  ('SPY', 'Merck &amp; Co Inc', 'MRK', null, 0.0047),
  ('SPY', 'Netflix Inc', 'NFLX', 'US64110L1061', 0.0046),
  ('SPY', 'Sandisk Corp/DE', 'SNDK', null, 0.0046),
  ('SPY', 'Goldman Sachs Group Inc/The', 'GS', null, 0.0045),
  ('SPY', 'GE Vernova Inc', 'GEV', null, 0.0042),
  ('SPY', 'Philip Morris International Inc', 'PM', null, 0.0042),
  ('SPY', 'Palantir Technologies Inc', 'PLTR', null, 0.004),
  ('SPY', 'Wells Fargo &amp; Co', 'WFC', null, 0.0038),
  ('SPY', 'Texas Instruments Inc', 'TXN', null, 0.0038),
  ('SPY', 'Dell Technologies Inc', 'DELL', null, 0.0038),
  ('SPY', 'International Business Machines Corp', 'IBM', null, 0.0038),
  ('SPY', 'RTX Corp', 'RTX', null, 0.0038),
  ('SPY', 'Palo Alto Networks Inc', 'PANW', null, 0.0037),
  ('SPY', 'Citigroup Inc', 'C', null, 0.0036),
  ('IWDA', 'NVIDIA Corp', 'NVDA', 'US67066G1040', 0.04949),
  ('IWDA', 'Apple Inc', 'AAPL', 'US0378331005', 0.04402),
  ('IWDA', 'Microsoft Corp', 'MSFT', 'US5949181045', 0.02932),
  ('IWDA', 'Amazon.com Inc', 'AMZN', 'US0231351067', 0.02655),
  ('IWDA', 'Alphabet Inc', 'GOOGL', 'US02079K3059', 0.02265),
  ('IWDA', 'Alphabet Inc (GOOG)', 'GOOG', 'US02079K1079', 0.02109),
  ('IWDA', 'Broadcom Inc', 'AVGO', 'US11135F1012', 0.01846),
  ('IWDA', 'Tesla Inc', 'TSLA', 'US88160R1014', 0.01505),
  ('IWDA', 'Meta Platforms Inc', 'META', 'US30303M1027', 0.01484),
  ('IWDA', 'Micron Technology Inc', 'MU', null, 0.01349),
  ('IWDA', 'Eli Lilly &amp; Co', 'LLY', 'US5324571083', 0.01143),
  ('IWDA', 'Berkshire Hathaway Inc', 'BRK.B', 'US0846707026', 0.01136),
  ('IWDA', 'Walmart Inc', 'WMT', 'US9311421039', 0.0098),
  ('IWDA', 'JPMorgan Chase &amp; Co', 'JPM', 'US46625H1005', 0.00937),
  ('IWDA', 'Advanced Micro Devices Inc', 'AMD', 'US0079031078', 0.00895),
  ('IWDA', 'Visa Inc', 'V', 'US92826C8394', 0.00682),
  ('IWDA', 'Intel Corp', 'INTC', null, 0.00682),
  ('IWDA', 'Johnson &amp; Johnson', 'JNJ', 'US4781601046', 0.00646),
  ('IWDA', 'Exxon Mobil Corp', 'XOM', 'US30231G1022', 0.00604),
  ('IWDA', 'Applied Materials Inc', 'AMAT', null, 0.00525),
  ('IWDA', 'Lam Research Corp', 'LRCX', null, 0.00504),
  ('IWDA', 'Caterpillar Inc', 'CAT', null, 0.0049),
  ('IWDA', 'Cisco Systems Inc', 'CSCO', null, 0.00476),
  ('IWDA', 'AbbVie Inc', 'ABBV', 'US00287Y1091', 0.00476),
  ('IWDA', 'Mastercard Inc', 'MA', 'US57636Q1040', 0.00469),
  ('IWDA', 'Oracle Corp', 'ORCL', 'US68389X1054', 0.00454),
  ('IWDA', 'Costco Wholesale Corp', 'COST', 'US22160K1051', 0.00447),
  ('IWDA', 'Bank of America Corp', 'BAC', 'US0605051046', 0.00433),
  ('IWDA', 'UnitedHealth Group Inc', 'UNH', 'US91324P1021', 0.00412),
  ('IWDA', 'General Electric Co', 'GE', null, 0.00412),
  ('IWDA', 'Coca-Cola Co/The', 'KO', 'US1912161007', 0.00376),
  ('IWDA', 'Procter &amp; Gamble Co/The', 'PG', 'US7427181091', 0.00369),
  ('IWDA', 'Home Depot Inc/The', 'HD', 'US4370761029', 0.00369),
  ('IWDA', 'Chevron Corp', 'CVX', 'US1667641005', 0.00362),
  ('IWDA', 'Morgan Stanley', 'MS', null, 0.00355),
  ('IWDA', 'KLA Corp', 'KLAC', null, 0.00341),
  ('IWDA', 'Merck &amp; Co Inc', 'MRK', null, 0.00334),
  ('IWDA', 'Netflix Inc', 'NFLX', 'US64110L1061', 0.00327),
  ('IWDA', 'Sandisk Corp/DE', 'SNDK', null, 0.00327),
  ('IWDA', 'Goldman Sachs Group Inc/The', 'GS', null, 0.0032),
  ('IWDA', 'ASML Holding NV', 'ASML', 'NL0010273215', 0.007),
  ('IWDA', 'Novo Nordisk A/S', 'NOVO-B', 'DK0062498333', 0.0055),
  ('IWDA', 'SAP SE', 'SAP', 'DE0007164600', 0.005),
  ('IWDA', 'Nestle SA', 'NESN', 'CH0038863350', 0.0045),
  ('IWDA', 'Roche Holding AG', 'ROG', 'CH0012032048', 0.004),
  ('IWDA', 'Toyota Motor Corp', '7203', 'JP3633400001', 0.004),
  ('IWDA', 'AstraZeneca PLC', 'AZN', 'GB0009895292', 0.0038),
  ('IWDA', 'Novartis AG', 'NOVN', 'CH0012005267', 0.0035),
  ('IWDA', 'Shell PLC', 'SHEL', 'GB00BP6MXD84', 0.0033),
  ('IWDA', 'LVMH', 'MC', 'FR0000121014', 0.003),
  ('IWDA', 'HSBC Holdings PLC', 'HSBA', 'GB0005405286', 0.0028),
  ('IWDA', 'Siemens AG', 'SIE', 'DE0007236101', 0.0027),
  ('IWDA', 'Commonwealth Bank', 'CBA', 'AU000000CBA7', 0.0025),
  ('IWDA', 'Mitsubishi UFJ Financial', '8306', 'JP3902900004', 0.0024),
  ('IWDA', 'Sony Group Corp', '6758', 'JP3435000009', 0.0022),
  ('IWDA', 'Allianz SE', 'ALV', 'DE0008404005', 0.002),
  ('VWCE', 'NVIDIA Corp', 'NVDA', 'US67066G1040', 0.04321),
  ('VWCE', 'Apple Inc', 'AAPL', 'US0378331005', 0.03844),
  ('VWCE', 'Microsoft Corp', 'MSFT', 'US5949181045', 0.02561),
  ('VWCE', 'Amazon.com Inc', 'AMZN', 'US0231351067', 0.02319),
  ('VWCE', 'Alphabet Inc', 'GOOGL', 'US02079K3059', 0.01978),
  ('VWCE', 'Alphabet Inc (GOOG)', 'GOOG', 'US02079K1079', 0.01841),
  ('VWCE', 'Broadcom Inc', 'AVGO', 'US11135F1012', 0.01612),
  ('VWCE', 'Tesla Inc', 'TSLA', 'US88160R1014', 0.01314),
  ('VWCE', 'Meta Platforms Inc', 'META', 'US30303M1027', 0.01296),
  ('VWCE', 'Micron Technology Inc', 'MU', null, 0.01178),
  ('VWCE', 'Eli Lilly &amp; Co', 'LLY', 'US5324571083', 0.00998),
  ('VWCE', 'Berkshire Hathaway Inc', 'BRK.B', 'US0846707026', 0.00992),
  ('VWCE', 'Walmart Inc', 'WMT', 'US9311421039', 0.00856),
  ('VWCE', 'JPMorgan Chase &amp; Co', 'JPM', 'US46625H1005', 0.00818),
  ('VWCE', 'Advanced Micro Devices Inc', 'AMD', 'US0079031078', 0.00781),
  ('VWCE', 'Visa Inc', 'V', 'US92826C8394', 0.00595),
  ('VWCE', 'Intel Corp', 'INTC', null, 0.00595),
  ('VWCE', 'Johnson &amp; Johnson', 'JNJ', 'US4781601046', 0.00564),
  ('VWCE', 'Exxon Mobil Corp', 'XOM', 'US30231G1022', 0.00527),
  ('VWCE', 'Applied Materials Inc', 'AMAT', null, 0.00459),
  ('VWCE', 'Lam Research Corp', 'LRCX', null, 0.0044),
  ('VWCE', 'Caterpillar Inc', 'CAT', null, 0.00428),
  ('VWCE', 'Cisco Systems Inc', 'CSCO', null, 0.00415),
  ('VWCE', 'AbbVie Inc', 'ABBV', 'US00287Y1091', 0.00415),
  ('VWCE', 'Mastercard Inc', 'MA', 'US57636Q1040', 0.00409),
  ('VWCE', 'Oracle Corp', 'ORCL', 'US68389X1054', 0.00397),
  ('VWCE', 'Costco Wholesale Corp', 'COST', 'US22160K1051', 0.00391),
  ('VWCE', 'Bank of America Corp', 'BAC', 'US0605051046', 0.00378),
  ('VWCE', 'UnitedHealth Group Inc', 'UNH', 'US91324P1021', 0.0036),
  ('VWCE', 'General Electric Co', 'GE', null, 0.0036),
  ('VWCE', 'Coca-Cola Co/The', 'KO', 'US1912161007', 0.00329),
  ('VWCE', 'Procter &amp; Gamble Co/The', 'PG', 'US7427181091', 0.00322),
  ('VWCE', 'Home Depot Inc/The', 'HD', 'US4370761029', 0.00322),
  ('VWCE', 'Chevron Corp', 'CVX', 'US1667641005', 0.00316),
  ('VWCE', 'Morgan Stanley', 'MS', null, 0.0031),
  ('VWCE', 'KLA Corp', 'KLAC', null, 0.00298),
  ('VWCE', 'Merck &amp; Co Inc', 'MRK', null, 0.00291),
  ('VWCE', 'Netflix Inc', 'NFLX', 'US64110L1061', 0.00285),
  ('VWCE', 'Sandisk Corp/DE', 'SNDK', null, 0.00285),
  ('VWCE', 'Goldman Sachs Group Inc/The', 'GS', null, 0.00279),
  ('VWCE', 'ASML Holding NV', 'ASML', 'NL0010273215', 0.007),
  ('VWCE', 'Novo Nordisk A/S', 'NOVO-B', 'DK0062498333', 0.0055),
  ('VWCE', 'SAP SE', 'SAP', 'DE0007164600', 0.005),
  ('VWCE', 'Nestle SA', 'NESN', 'CH0038863350', 0.0045),
  ('VWCE', 'Roche Holding AG', 'ROG', 'CH0012032048', 0.004),
  ('VWCE', 'Toyota Motor Corp', '7203', 'JP3633400001', 0.004),
  ('VWCE', 'AstraZeneca PLC', 'AZN', 'GB0009895292', 0.0038),
  ('VWCE', 'Novartis AG', 'NOVN', 'CH0012005267', 0.0035),
  ('VWCE', 'Shell PLC', 'SHEL', 'GB00BP6MXD84', 0.0033),
  ('VWCE', 'LVMH', 'MC', 'FR0000121014', 0.003),
  ('VWCE', 'HSBC Holdings PLC', 'HSBA', 'GB0005405286', 0.0028),
  ('VWCE', 'Siemens AG', 'SIE', 'DE0007236101', 0.0027),
  ('VWCE', 'Commonwealth Bank', 'CBA', 'AU000000CBA7', 0.0025),
  ('VWCE', 'Mitsubishi UFJ Financial', '8306', 'JP3902900004', 0.0024),
  ('VWCE', 'Sony Group Corp', '6758', 'JP3435000009', 0.0022),
  ('VWCE', 'Allianz SE', 'ALV', 'DE0008404005', 0.002),
  ('VWCE', 'Taiwan Semiconductor (TSMC)', 'TSM', 'US8740391003', 0.011),
  ('VWCE', 'Tencent Holdings', '0700', 'KYG875721634', 0.005),
  ('VWCE', 'Samsung Electronics', '005930', 'KR7005930003', 0.0035),
  ('VWCE', 'Alibaba Group', 'BABA', 'US01609W1027', 0.0028)
on conflict (etf_symbol, constituent_name) do nothing;

-- Sector + geographic region classifications (look-through). --------------------
-- Guard the columns so re-running schema.sql on a database created before these
-- columns existed adds them (create table if not exists is a no-op there).
alter table public.instruments add column if not exists sector text;
alter table public.instruments add column if not exists region text;
alter table public.instrument_constituents add column if not exists sector text;
alter table public.instrument_constituents add column if not exists region text;

update public.instruments set sector = 'Information Technology', region = 'North America'
  where symbol in ('AAPL', 'MSFT', 'NVDA');
update public.instruments set sector = 'Consumer Discretionary', region = 'North America'
  where symbol in ('AMZN', 'TSLA');
update public.instruments set sector = 'Digital Assets', region = 'Crypto'
  where type = 'CRYPTO';
update public.instrument_constituents set sector = 'Information Technology', region = 'North America'
  where constituent_symbol in ('AAPL', 'MSFT', 'NVDA', 'AVGO');
update public.instrument_constituents set sector = 'Consumer Discretionary', region = 'North America'
  where constituent_symbol in ('AMZN', 'TSLA');
update public.instrument_constituents set sector = 'Communication Services', region = 'North America'
  where constituent_symbol in ('META', 'GOOGL');
