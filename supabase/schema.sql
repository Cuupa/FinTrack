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
  display_name text,
  locale text,
  theme text,
  tax_allowance numeric not null default 1000,
  church_tax_rate numeric not null default 0,
  tax_teilfreistellung boolean not null default false,
  tax_vorabpauschale jsonb not null default '{}'::jsonb,
  tax_withheld_override jsonb not null default '{}'::jsonb,
  tour_done_at timestamptz,
  tours_done jsonb not null default '{}'::jsonb,
  -- Persisted /rebalancing plan (COMPETITION.md F10): {mode, weights, custom}.
  rebalance_targets jsonb not null default '{"mode":"trade","weights":{},"custom":[]}'::jsonb,
  -- Retirement projection assumptions (migration 0106): {birthYear,
  -- retirementAge, annualPoints, targetMonthly}.
  pension_settings jsonb not null default '{"birthYear":null,"retirementAge":null,"annualPoints":null,"targetMonthly":null,"totalPoints":null,"totalPointsYear":null}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists locale text;
alter table public.profiles add column if not exists theme text;
alter table public.profiles add column if not exists tax_allowance numeric not null default 1000;
alter table public.profiles add column if not exists church_tax_rate numeric not null default 0;
alter table public.profiles add column if not exists tax_teilfreistellung boolean not null default false;
alter table public.profiles add column if not exists tax_vorabpauschale jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists tax_withheld_override jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists tour_done_at timestamptz;
alter table public.profiles add column if not exists tours_done jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists rebalance_targets jsonb not null default '{"mode":"trade","weights":{},"custom":[]}'::jsonb;
alter table public.profiles add column if not exists pension_settings jsonb not null default '{"birthYear":null,"retirementAge":null,"annualPoints":null,"targetMonthly":null,"totalPoints":null,"totalPointsYear":null}'::jsonb;

-- Instruments catalog --------------------------------------------------------
-- Global reference data (the known assets + provider quote symbols). Source of
-- truth for auto-import and live-quote lookups; seeded in instruments_seed.sql.
create table if not exists public.instruments (
  id uuid primary key default gen_random_uuid(),
  isin text,
  wkn text,
  symbol text,
  name text not null,
  type text not null check (type in ('ETF', 'STOCK', 'CRYPTO', 'CASH', 'COMMODITY')),
  currency text,
  country text,
  sector text,
  region text,
  quote_source text check (quote_source in ('yahoo', 'stooq', 'coingecko')),
  quote_id text,
  base_price numeric not null default 100,
  -- Multiplier applied to a resolved market price to convert provider units
  -- into the instrument's native display units (e.g. gold quotes per troy
  -- ounce, held per gram, so quote_scale = 1/31.1034768).
  quote_scale numeric not null default 1,
  drift numeric not null default 0.07,
  vol numeric not null default 0.2,
  dividend_yield numeric not null default 0,
  dividend_synced_at timestamptz,
  -- Live price cached by the price-sync cron (see /api/cron/sync-prices).
  last_price numeric,
  price_synced_at timestamptz,
  -- Official-name resolution staleness marker for the names-sync cron.
  name_synced_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.instruments add column if not exists quote_scale numeric not null default 1;
alter table public.instruments add column if not exists name_synced_at timestamptz;
-- `create table if not exists` above is a no-op on an existing database, so
-- re-apply the widened type check idempotently for upgrades too.
alter table public.instruments drop constraint if exists instruments_type_check;
alter table public.instruments
  add constraint instruments_type_check check (type in ('ETF', 'STOCK', 'CRYPTO', 'CASH', 'COMMODITY'));
-- Symbol uniqueness across the (global) instruments catalog.
create unique index if not exists instruments_symbol_key
  on public.instruments (symbol) where symbol is not null;
create index if not exists instruments_isin_idx on public.instruments (isin);
create index if not exists instruments_wkn_idx on public.instruments (wkn);
-- Matches the names-sync cron's batch scan (order by name_synced_at asc
-- nulls first, limited); see app/api/cron/sync/names/route.ts.
create index if not exists instruments_name_synced_at_idx
  on public.instruments (name_synced_at asc nulls first);
-- isin/wkn uniqueness (mirrors instruments_symbol_key above), closing the same
-- race for the other two identifiers. `not valid` so a legacy value that
-- fails the format check doesn't block the migration on existing rows.
create unique index if not exists instruments_isin_key on public.instruments (isin) where isin is not null;
create unique index if not exists instruments_wkn_key  on public.instruments (wkn)  where wkn is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'instruments_isin_format') then
    alter table public.instruments add constraint instruments_isin_format
      check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instruments_wkn_format') then
    alter table public.instruments add constraint instruments_wkn_format
      check (wkn is null or wkn ~ '^[A-Z0-9]{6}$') not valid;
  end if;
end $$;

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

-- Cached benchmark price history (daily close), so the chart comparison feature
-- reads from the DB instead of hitting Yahoo on every view. Refreshed lazily by
-- /api/benchmarks when stale.
create table if not exists public.benchmark_history (
  benchmark_id text not null,
  date date not null,
  close numeric not null,
  -- The native series plus a copy pre-converted (via historic FX) into each
  -- common base currency; one row per (benchmark, date, currency).
  currency text not null default 'EUR',
  primary key (benchmark_id, date, currency)
);
alter table public.benchmark_history add column if not exists currency text;
create index if not exists benchmark_history_id_currency_date_idx
  on public.benchmark_history (benchmark_id, currency, date desc);

-- Cached REAL price history per asset (keyed by price key + timeframe range), in
-- the asset's native currency. Shared, world-readable reference data written by
-- the /api/history route (service role); cuts repeated slow Yahoo/CoinGecko
-- calls. `synced_at` drives staleness. One row per (price_key, range, date).
create table if not exists public.instrument_history (
  price_key text not null,
  range text not null,
  date date not null,
  close numeric not null,
  synced_at timestamptz not null default now(),
  primary key (price_key, range, date)
);
create index if not exists instrument_history_key_range_date_idx
  on public.instrument_history (price_key, range, date desc);
-- Supports the retention prune scan (app/api/cron/sync/retention), which
-- deletes rows past a synced_at cutoff.
create index if not exists instrument_history_synced_at_idx
  on public.instrument_history (synced_at);

-- Cached ETF sector/region weightings, so Analysis reads from the DB instead of
-- hitting Yahoo/onvista on every view. Refreshed by /api/cron/sync-etf-breakdowns.
create table if not exists public.etf_breakdowns (
  etf_key text not null,
  kind text not null check (kind in ('sector', 'region', 'country')),
  data jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (etf_key, kind)
);
-- Widen the kind check for existing installs (added 'country').
alter table public.etf_breakdowns drop constraint if exists etf_breakdowns_kind_check;
alter table public.etf_breakdowns
  add constraint etf_breakdowns_kind_check check (kind in ('sector', 'region', 'country'));

-- Basiszins per year for the Vorabpauschale estimate (COMPETITION.md F6).
-- Published annually by the Bundesbank/BMF; reference data, world-readable,
-- owner-written. Rate is a decimal fraction (0.0255 = 2.55%); negative years
-- yield no Vorabpauschale.
create table if not exists public.basiszins (
  year int primary key,
  rate numeric not null,
  note text
);
alter table public.basiszins enable row level security;
drop policy if exists "basiszins readable" on public.basiszins;
create policy "basiszins readable" on public.basiszins for select using (true);
insert into public.basiszins (year, rate, note) values
  (2018, 0.0087, 'BMF Basiszins 0.87%'),
  (2019, 0.0052, 'BMF Basiszins 0.52%'),
  (2020, 0.0007, 'BMF Basiszins 0.07%'),
  (2021, -0.0045, 'BMF Basiszins -0.45% (negative, no Vorabpauschale)'),
  (2022, -0.0005, 'BMF Basiszins -0.05% (negative, no Vorabpauschale)'),
  (2023, 0.0255, 'BMF Basiszins 2.55%'),
  (2024, 0.0229, 'BMF Basiszins 2.29%'),
  (2025, 0.0253, 'BMF Basiszins 2.53%')
on conflict (year) do nothing;

-- Aktueller Rentenwert (gross monthly euro per Entgeltpunkt) + Sicherungsniveau
-- vor Steuern per year (migration 0106, flag `pension`). Set by the annual
-- Rentenwertbestimmungsverordnung and effective 1 July, so a year's row is the
-- value in force in its second half; the finance layer reads it carry-forward.
-- Reference data, world-readable, owner-written -- the same rule as basiszins:
-- points can only be turned into euro with this table, never with a constant.
-- `max_points` is the most Entgeltpunkte one year of work can earn
-- (Beitragsbemessungsgrenze / Durchschnittsentgelt, which the legislator keeps
-- at roughly 2.0). The projection caps its per-remaining-year assumption with
-- it, so a CUMULATIVE total typed into a single year's row cannot multiply into
-- a fantasy pension -- see migration 0111.
create table if not exists public.pension_reference (
  year int primary key,
  pension_value numeric not null,
  level_pct numeric,
  note text,
  max_points numeric
);
alter table public.pension_reference enable row level security;
drop policy if exists "pension reference readable" on public.pension_reference;
create policy "pension reference readable" on public.pension_reference for select using (true);
insert into public.pension_reference (year, pension_value, level_pct, max_points, note) values
  (2018, 32.03, 48.1, 2.06, 'Rentenwert West ab 01.07.2018'),
  (2019, 33.05, 48.2, 2.07, 'Rentenwert West ab 01.07.2019'),
  (2020, 34.19, 48.2, 2.04, 'Rentenwert West ab 01.07.2020'),
  (2021, 34.19, 49.4, 2.05, 'Rentenwert West ab 01.07.2021 (keine Erhoehung)'),
  (2022, 36.02, 48.1, 2.01, 'Rentenwert West ab 01.07.2022'),
  (2023, 37.60, 48.2, 2.03, 'Rentenwert West ab 01.07.2023'),
  (2024, 39.32, 48.1, 2.00, 'Rentenwert ab 01.07.2024 (Ost/West vereinheitlicht)'),
  (2025, 40.79, 48.0, 1.91, 'Rentenwert ab 01.07.2025')
on conflict (year) do nothing;

-- Best-effort DB-backed per-IP rate limiting for the market-data API proxies.
-- Fixed-window counters keyed by "route:ip:window"; an atomic upsert function
-- returns the running count so a serverless instance (no shared memory) can
-- still enforce a limit. Only the service-role client (secret key) calls the
-- function; RLS denies everyone else.
create table if not exists public.rate_limit_counters (
  bucket text primary key,
  count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_counters_created_at_idx
  on public.rate_limit_counters (created_at);
alter table public.rate_limit_counters enable row level security;

create or replace function public.rate_limit_hit(p_bucket text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c int;
begin
  insert into public.rate_limit_counters (bucket, count) values (p_bucket, 1)
  on conflict (bucket) do update set count = public.rate_limit_counters.count + 1
  returning count into c;
  if random() < 0.02 then
    delete from public.rate_limit_counters where created_at < now() - interval '1 hour';
  end if;
  return c;
end;
$$;

-- Shared portfolio snapshots: a short id → the (already mode-appropriate) JSON
-- payload, so share links can be short instead of carrying the whole snapshot.
-- World-readable (that's the point of a share link); written by the service role.
create table if not exists public.shared_portfolios (
  id text primary key,
  payload jsonb not null,
  owner uuid,
  mode text not null default 'snapshot',
  creator_ip text,
  expires_at timestamptz,  -- null = never expires; enforced by RLS (migration 0034) + swept by cron
  created_at timestamptz not null default now()
);
alter table public.shared_portfolios add column if not exists owner uuid;
alter table public.shared_portfolios add column if not exists mode text not null default 'snapshot';
alter table public.shared_portfolios add column if not exists creator_ip text;
alter table public.shared_portfolios add column if not exists expires_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shared_portfolios_payload_size') then
    alter table public.shared_portfolios
      add constraint shared_portfolios_payload_size
      check (pg_column_size(payload) <= 262144) not valid;
  end if;
end $$;
create index if not exists shared_portfolios_created_at_idx on public.shared_portfolios (created_at desc);
create index if not exists shared_portfolios_creator_ip_idx on public.shared_portfolios (creator_ip, created_at desc);

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
-- CASH interest (COMPETITION.md F7): a cash position may carry an annual
-- nominal rate (percent) and a compounding frequency. Interest accrues and is
-- booked as INTEREST transactions after review (lib/finance/cash-interest.ts).
-- Null on non-cash / non-interest-bearing balances.
alter table public.assets add column if not exists interest_rate numeric;
alter table public.assets add column if not exists interest_frequency text;
-- Which calendar day interest posts on: 'first'|'last', null = the legacy
-- day-of-month-of-first-transaction behaviour (lib/finance/cash-interest.ts).
alter table public.assets add column if not exists interest_post_day text;
create index if not exists assets_user_id_idx on public.assets (user_id);
create index if not exists assets_instrument_id_idx on public.assets (instrument_id);

-- Portfolios -----------------------------------------------------------------
-- A user can hold several portfolios; transactions belong to one of them.
create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Main',
  created_at timestamptz not null default now()
);
create index if not exists portfolios_user_id_idx on public.portfolios (user_id);

-- Per-portfolio broker fee model (settings "Broker & fees"): prefills, never
-- forces, the fee on new buy/sell/savings-plan transactions.
alter table public.portfolios add column if not exists fee_order_flat numeric not null default 0;
alter table public.portfolios add column if not exists fee_order_free_from numeric;
alter table public.portfolios add column if not exists fee_savings_plan numeric not null default 0;

-- Per-portfolio (broker) Freistellungsauftrag: null = none registered at that
-- broker; the global profiles.tax_allowance stays the fallback (lib/finance/tax.ts).
alter table public.portfolios add column if not exists tax_allowance numeric;

-- Transactions ---------------------------------------------------------------
-- No user_id: ownership is derived via the asset (3NF — avoids the transitive
-- dependency id -> asset_id -> user_id).
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  -- BOOKING = free crediting (Einbuchung), added at zero cost basis.
  -- INTEREST = interest credited to a cash position, also zero cost basis.
  -- SPLIT = stock split / corporate action; quantity holds the ratio (new
  -- shares per old share), price/fee/tax are always 0.
  type text not null check (type in ('BUY', 'SELL', 'BOOKING', 'INTEREST', 'SPLIT')),
  quantity numeric not null check (quantity > 0),
  price numeric not null check (price >= 0),
  fee numeric not null default 0 check (fee >= 0),
  -- Tax withheld on the transaction (Abgeltungsteuer on sells, transaction
  -- tax on some buys). Mirrors fee: buy tax raises basis, sell tax reduces
  -- proceeds.
  tax numeric not null default 0 check (tax >= 0),
  -- Trade date + time of day as a floating wall-clock (no time zone) — what
  -- the user picked, shown verbatim; avoids UTC reinterpretation/shifting.
  executed_at timestamp not null,
  portfolio_id uuid references public.portfolios (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.transactions
  add column if not exists portfolio_id uuid references public.portfolios (id) on delete cascade;
alter table public.transactions
  add column if not exists tax numeric not null default 0 check (tax >= 0);
create index if not exists transactions_asset_id_idx on public.transactions (asset_id);
create index if not exists transactions_portfolio_id_idx on public.transactions (portfolio_id);
-- `create table if not exists` above is a no-op on an existing database, so
-- re-apply the widened type check idempotently for upgrades too.
alter table public.transactions
  drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (type in ('BUY', 'SELL', 'BOOKING', 'INTEREST', 'SPLIT'));

-- Watchlist -------------------------------------------------------------------
-- Instruments the user follows without holding them; links to the shared
-- instruments catalog like assets do.
create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid not null references public.instruments (id),
  -- Per-item currency override, same idea as assets.currency above; null
  -- falls back to the shared instrument's currency.
  currency text,
  created_at timestamptz not null default now()
);
create index if not exists watchlist_items_user_id_idx on public.watchlist_items (user_id);
-- FK integrity checks against instruments.
create index if not exists watchlist_items_instrument_id_idx on public.watchlist_items (instrument_id);
create unique index if not exists watchlist_items_user_instrument_key
  on public.watchlist_items (user_id, instrument_id);
alter table public.watchlist_items add column if not exists currency text;

-- Savings plans ---------------------------------------------------------------
-- Recurring buy rules (Sparpläne). Due occurrences are materialized client-side
-- as ordinary BUY transactions after an explicit user review; `last_run_date`
-- advances so each occurrence happens once. `frequency` (not `interval`) to
-- steer clear of the reserved type name.
create table if not exists public.savings_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  amount numeric not null check (amount > 0),
  frequency text not null check (frequency in ('WEEKLY', 'MONTHLY', 'QUARTERLY')),
  booking_type text not null default 'BUY',
  start_date date not null,
  active boolean not null default true,
  last_run_date date,
  created_at timestamptz not null default now()
);
alter table public.savings_plans add column if not exists booking_type text not null default 'BUY';
create index if not exists savings_plans_user_id_idx on public.savings_plans (user_id);
-- Cascade path from assets deletes.
create index if not exists savings_plans_asset_id_idx on public.savings_plans (asset_id);
-- Cascade path from portfolios deletes.
create index if not exists savings_plans_portfolio_id_idx on public.savings_plans (portfolio_id);

-- Asset tags -----------------------------------------------------------------
-- User-defined key-value tag groups + per-asset assignments (rides the same
-- DataStore seam as watchlist/savings plans; Guest Mode keeps them in its
-- localStorage blob instead).
create table if not exists public.tag_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists tag_groups_user_id_idx on public.tag_groups (user_id);

-- One row per (asset, group, value) — `setAssetTags` replaces the full set
-- for a (asset, group) pair by deleting then re-inserting, so replay is
-- idempotent regardless of ordering.
create table if not exists public.asset_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  group_id uuid not null references public.tag_groups (id) on delete cascade,
  value text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists asset_tags_unique_key
  on public.asset_tags (asset_id, group_id, value);
create index if not exists asset_tags_asset_id_idx on public.asset_tags (asset_id);
create index if not exists asset_tags_group_id_idx on public.asset_tags (group_id);
create index if not exists asset_tags_user_id_idx on public.asset_tags (user_id);

-- Manual valuation points for OTHER assets (COMPETITION.md F8): real estate,
-- collectibles, unlisted holdings the user values by hand. One row per (asset,
-- date); `setAssetValuations` replaces an asset's full set by delete-then-
-- insert, so replay is idempotent. Rides the DataStore seam like tags above.
create table if not exists public.asset_valuations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  valued_on date not null,
  value numeric not null,
  created_at timestamptz not null default now()
);
create unique index if not exists asset_valuations_unique_key
  on public.asset_valuations (asset_id, valued_on);
create index if not exists asset_valuations_asset_id_idx on public.asset_valuations (asset_id);
create index if not exists asset_valuations_user_id_idx on public.asset_valuations (user_id);

-- Accounts & liabilities (ROADMAP #1, flag `accounts`): balance accounts the
-- user sets (checking/savings/credit/loan/mortgage/other) folded into net
-- worth; liabilities (`is_liability`) subtract. `account_balances` are dated
-- readings (carry-forward step series), `opening_balance` at `opened_on` the
-- implicit first point.
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'checking',
  currency text,
  is_liability boolean not null default false,
  opening_balance numeric not null default 0,
  opened_on date not null,
  created_at timestamptz not null default now()
);
-- Debt payoff (ROADMAP #9, flag `debtPayoff`): optional per-account
-- amortisation inputs, nullable until the user wants a payoff schedule.
alter table public.accounts
  add column if not exists interest_rate numeric;
alter table public.accounts
  add column if not exists min_payment numeric;
-- Fixed-rate period (migration 0102): up to `rate_fixed_until` the account's
-- `interest_rate` applies, from the day after `follow_up_rate` does. Two
-- columns rather than one, so entering the assumed follow-up rate never
-- rewrites the rate in force today.
alter table public.accounts
  add column if not exists rate_fixed_until date;
alter table public.accounts
  add column if not exists follow_up_rate numeric;
-- Credit interest (migration 0104): on an ASSET account `interest_rate` is
-- what the bank pays, and this says how often it is credited and compounded.
-- Null = monthly, which is what liability accrual always did.
alter table public.accounts
  add column if not exists interest_frequency text;
alter table public.accounts
  drop constraint if exists accounts_interest_frequency_check;
alter table public.accounts
  add constraint accounts_interest_frequency_check check (
    interest_frequency is null
    or interest_frequency in ('MONTHLY', 'QUARTERLY', 'ANNUAL')
  );
alter table public.accounts
  drop constraint if exists accounts_kind_check;
alter table public.accounts
  add constraint accounts_kind_check check (
    kind in ('checking', 'savings', 'credit', 'loan', 'mortgage', 'other_asset', 'other_liability')
  );
create index if not exists accounts_user_id_idx on public.accounts (user_id);

create table if not exists public.account_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  balance_on date not null,
  balance numeric not null,
  created_at timestamptz not null default now()
);
create unique index if not exists account_balances_unique_key
  on public.account_balances (account_id, balance_on);
create index if not exists account_balances_account_id_idx on public.account_balances (account_id);
create index if not exists account_balances_user_id_idx on public.account_balances (user_id);

-- Planned one-off repayments (Sondertilgungen) deliberately have NO table
-- (0105 created one, 0110 dropped it): they are a what-if lever on /debt, live
-- in React state next to the extra monthly payment, and die with the page.

-- Retirement provision (migration 0106, flag `pension`) ----------------------
-- One year of the user's Renteninformation. Keyed by YEAR rather than by an
-- opaque id: the editor replace-sets the whole record, so a replayed offline
-- write is idempotent and a year can never be recorded twice (the same reason
-- account_balances is keyed by date).
create table if not exists public.pension_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  year int not null,
  points numeric not null,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists pension_points_unique_key
  on public.pension_points (user_id, year);
create index if not exists pension_points_user_id_idx on public.pension_points (user_id);

-- A policy that PAYS a monthly pension (private Rentenversicherung, Riester,
-- Ruerup, a company scheme). A sibling of `contracts`, not one of its
-- insurance types: a contract is money going out every month, this is defined
-- by the income it will pay from a date decades away. Deliberately not shared
-- with household peers -- a pension entitlement is personal.
create table if not exists public.pension_contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'private'
    check (kind in ('private', 'riester', 'ruerup', 'occupational', 'statutory_other', 'other')),
  provider text,
  monthly_contribution numeric,
  current_value numeric,
  expected_monthly_pension numeric,
  starts_on date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists pension_contracts_user_id_idx on public.pension_contracts (user_id);

-- Household / collaboration (ROADMAP #13, flag `household`): shared
-- read/write access to another registered user's financial data. v1 caps
-- membership at ONE household per user (household_members.user_id has a
-- unique index) -- this sidesteps "which household's accounts am I seeing"
-- ambiguity entirely. No transactional-email infra exists in this app, so
-- invites are NOT emailed: an invite is a row keyed by the invitee's email;
-- the invited user sees it in-app (their own signed-in email matches a
-- pending invite) and accepts/declines from there. See migration
-- 0091_households.sql / 0092_household_accounts.sql for the full rationale.
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now()
);
create unique index if not exists household_members_one_per_user
  on public.household_members (user_id);
create index if not exists household_members_household_id_idx
  on public.household_members (household_id);

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now()
);
create index if not exists household_invites_email_idx
  on public.household_invites (lower(email));
create index if not exists household_invites_household_id_idx
  on public.household_invites (household_id);

-- SECURITY DEFINER helpers so per-table RLS policies (accounts today, more
-- tables in later rounds) can extend "own row" to "own row OR a household
-- peer's row" without those policies needing their own read access to
-- household_members, and without household_members' own policies becoming
-- self-referential (a function owned by the table owner bypasses that
-- table's RLS internally).
create or replace function public.my_household_id()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from public.household_members where user_id = auth.uid() limit 1;
$$;
grant execute on function public.my_household_id() to authenticated;

-- NOTE: this plain version exists only so the policies further down can be
-- created; it is REPLACED below (see "Household sharing is a paid family
-- plan") by one that also requires a Pro member once the `household` flag is
-- tiered to 'pro'. The redefinition has to sit after the billing tables it
-- reads, because Postgres validates a SQL function body at creation time.
create or replace function public.household_peer_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from public.household_members
  where household_id = (select household_id from public.household_members where user_id = auth.uid() limit 1);
$$;
grant execute on function public.household_peer_ids() to authenticated;

create or replace function public.is_household_owner(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid() and role = 'owner'
  );
$$;
grant execute on function public.is_household_owner(uuid) to authenticated;

-- auth.users is not directly selectable by clients; this exposes only the
-- emails of people the caller already shares a household with (mutual
-- disclosure -- they already know each other's email from the invite),
-- never the full user list.
create or replace function public.household_member_emails()
returns table (user_id uuid, email text)
language sql stable security definer set search_path = public, auth as $$
  select hm.user_id, u.email
  from public.household_members hm
  join auth.users u on u.id = hm.user_id
  where hm.household_id = public.my_household_id();
$$;
grant execute on function public.household_member_emails() to authenticated;

-- Spending transactions & categories (ROADMAP #2, flag `spending`):
-- expense/income against an accounts row, categorised. `spending_categories`
-- is a flat taxonomy (group_name + name); a transaction carries exactly one
-- category so no junction table is needed. `recurring_id` is a bare nullable
-- uuid until the `contracts` table (ROADMAP #5) exists.
create table if not exists public.spending_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_name text not null,
  name text not null,
  -- Tax-deductible flag (ROADMAP #11, flag `taxPack`): nullable, feeds the
  -- tax pack's deductible-expenses summary. Unset = not deductible.
  tax_deductible boolean,
  created_at timestamptz not null default now()
);
create unique index if not exists spending_categories_unique_key
  on public.spending_categories (user_id, group_name, name);
create index if not exists spending_categories_user_id_idx on public.spending_categories (user_id);

create table if not exists public.spending_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  category_id uuid references public.spending_categories (id) on delete set null,
  date date not null,
  amount numeric not null,
  payee text not null,
  note text,
  recurring_id uuid,
  created_at timestamptz not null default now()
);
-- Transfer marker (migration 0096): set when the booking moved money to
-- another account of the user's own (loan instalment, wealth-building premium)
-- rather than spending it. Every aggregation in lib/finance/spending.ts skips
-- these rows -- they are neither income nor expense. Does not move any
-- balance; account values come from their readings, and ordinary spending does
-- not move them either.
alter table public.spending_transactions
  add column if not exists transfer_account_id uuid references public.accounts (id) on delete set null;

create index if not exists spending_transactions_account_id_idx on public.spending_transactions (account_id);
create index if not exists spending_transactions_transfer_account_id_idx on public.spending_transactions (transfer_account_id);
create index if not exists spending_transactions_category_id_idx on public.spending_transactions (category_id);
create index if not exists spending_transactions_user_id_idx on public.spending_transactions (user_id);

-- Budgets (ROADMAP #4, flag `budgets`): a monthly cap per category, in the
-- profile's base currency (spending.ts already converts category totals to
-- base). One row per category (unique user_id+category_id); deleting the
-- category deletes its budget (unlike spending_transactions, a budget with
-- no category means nothing).
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.spending_categories (id) on delete cascade,
  amount numeric not null,
  created_at timestamptz not null default now()
);
create unique index if not exists budgets_unique_category
  on public.budgets (user_id, category_id);
create index if not exists budgets_user_id_idx on public.budgets (user_id);

-- Recurring-charge contract register (ROADMAP #5, flag `contracts`):
-- subscriptions/insurance/rent as named recurring commitments with an
-- optional renewal date + cancellation-notice window. `category_id` reuses
-- the spending taxonomy; set null on category delete (a contract without a
-- category still means something, unlike a budget).
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  amount numeric not null,
  interval text not null,
  renewal_date date,
  cancellation_notice_days integer,
  category_id uuid references public.spending_categories (id) on delete set null,
  created_at timestamptz not null default now()
);
-- Booking columns (migration 0095): a contract with an `account_id` posts its
-- charge into spending on the schedule derived from
-- (booking_start_date, interval, last_booked_date). Null account_id = register
-- entry only, which is how contracts behaved before booking existed.
-- `on delete set null` matches category_id above: losing the account stops the
-- booking but does not delete the contract.
alter table public.contracts
  add column if not exists account_id uuid references public.accounts (id) on delete set null;
alter table public.contracts
  add column if not exists booking_start_date date;
alter table public.contracts
  add column if not exists last_booked_date date;
-- Migration 0096: where the money goes when the contract is not consumption
-- (the loan being repaid, the policy being paid into). Set, its bookings carry
-- transfer_account_id and stop counting as expense.
alter table public.contracts
  add column if not exists target_account_id uuid references public.accounts (id) on delete set null;

create index if not exists contracts_user_id_idx on public.contracts (user_id);
create index if not exists contracts_account_id_idx on public.contracts (account_id);
create index if not exists contracts_category_id_idx on public.contracts (category_id);
-- Insurance register (ROADMAP #10, flag `insurance`): typed rows on this same
-- contract entity. Null insurance_type = an ordinary (non-insurance) contract.
alter table public.contracts
  add column if not exists insurance_type text;
alter table public.contracts
  drop constraint if exists contracts_insurance_type_check;
alter table public.contracts
  add constraint contracts_insurance_type_check check (
    insurance_type is null or insurance_type in (
      'liability', 'health', 'household', 'legal', 'disability', 'life', 'vehicle', 'other'
    )
  );
alter table public.contracts
  add column if not exists sum_insured numeric;

-- Planned income & expenses (migration 0100, flag `plannedCashflow`): the
-- salary landing at the end of the month, a bonus, a tax refund, or a one-off
-- expense the user already knows about. Sibling of `contracts`, not an
-- extension of it: a contract is always money going out and has neither a ONCE
-- cadence nor an end date, and recurring-charge detection is expenses-only.
-- `amount` is SIGNED and in the ACCOUNT's native currency (mirrors
-- spending_transactions, not contracts/budgets), so booking a due occurrence is
-- a straight copy. account_id cascades, unlike contracts.account_id's set null:
-- the account is where the money lands and where its currency comes from.
create table if not exists public.planned_cashflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  category_id uuid references public.spending_categories (id) on delete set null,
  amount numeric not null,
  interval text not null,
  start_date date not null,
  end_date date,
  last_booked_date date,
  transfer_account_id uuid references public.accounts (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.planned_cashflows
  drop constraint if exists planned_cashflows_interval_check;
alter table public.planned_cashflows
  add constraint planned_cashflows_interval_check check (
    interval in ('ONCE', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL')
  );
create index if not exists planned_cashflows_user_id_idx on public.planned_cashflows (user_id);
create index if not exists planned_cashflows_account_id_idx on public.planned_cashflows (account_id);
create index if not exists planned_cashflows_category_id_idx on public.planned_cashflows (category_id);
create index if not exists planned_cashflows_transfer_account_id_idx
  on public.planned_cashflows (transfer_account_id);

-- Which planned cashflow posted a booking (migration 0100). A column of its own
-- rather than reusing recurring_id: that one is a foreign key to contracts, and
-- one nullable column cannot reference two tables. Set null on delete, so the
-- booking (real money that moved) survives its plan.
alter table public.spending_transactions
  add column if not exists planned_id uuid references public.planned_cashflows (id) on delete set null;
create index if not exists spending_transactions_planned_id_idx
  on public.spending_transactions (planned_id);

-- Named savings goals (ROADMAP #6, flag `goals`): a target amount, optionally
-- by a target date, whose progress either mirrors a linked account's current
-- balance or is entered manually. `linked_account_id` is nullable and set
-- null on account delete (a goal survives its linked account being deleted --
-- it just falls back to manual tracking, mirroring `contracts.category_id`).
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  target_amount numeric not null,
  target_date date,
  linked_account_id uuid references public.accounts (id) on delete set null,
  manual_current_amount numeric,
  -- Depot-tracking goals (migration 0097): progress is the portfolio's market
  -- value instead of an account balance. linked_portfolio_id null = every
  -- broker combined.
  tracks_investments boolean not null default false,
  linked_portfolio_id uuid references public.portfolios (id) on delete set null,
  -- Single-position goals (migration 0104): "the ETF should be worth 10k".
  -- Narrower than linked_portfolio_id and wins over it; null = the whole
  -- depot or one broker's. Set null (not cascade) with the asset, so the goal
  -- survives and falls back to the depot.
  linked_asset_id uuid references public.assets (id) on delete set null,
  -- Sub-goals (migration 0098): a composite goal ("trip to the USA") is the
  -- sum of its parts (flight, hotel, taxi), expressed by the children
  -- pointing here. Cascade, unlike linked_account_id's set null: a sub-goal
  -- without its parent means nothing.
  parent_goal_id uuid references public.goals (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists goals_user_id_idx on public.goals (user_id);
create index if not exists goals_linked_account_id_idx on public.goals (linked_account_id);
create index if not exists goals_linked_portfolio_id_idx on public.goals (linked_portfolio_id);
create index if not exists goals_linked_asset_id_idx on public.goals (linked_asset_id);
create index if not exists goals_parent_goal_id_idx on public.goals (parent_goal_id);

-- LLM assistant config (provider, model, API key) — one row per user; rides
-- the same DataStore seam as tags above (Guest Mode keeps it in its
-- localStorage blob instead). `saveLlmConfig` upserts on save, deletes the
-- row on removal, so this is always replace-set and replay-idempotent.
create table if not exists public.llm_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null,
  model text not null,
  api_key text not null,
  updated_at timestamptz not null default now()
);

-- Cached Monte Carlo simulation runs, keyed by a hash of the (seed-independent)
-- parameters. Rerunning with identical params reuses the stored result instead
-- of recomputing. The seed is kept for auditing/reproducibility.
create table if not exists public.simulation_runs (
  user_id uuid not null references auth.users (id) on delete cascade,
  params_hash text not null,
  params jsonb not null,
  seed bigint not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, params_hash)
);
-- Supports the retention prune scan (app/api/cron/sync/retention), which
-- deletes rows past a created_at cutoff.
create index if not exists simulation_runs_created_at_idx
  on public.simulation_runs (created_at);

-- Fingerprints of broker-CSV rows already imported, so re-uploading the same
-- export doesn't surface already-merged transactions as conflicts again.
create table if not exists public.imported_rows (
  user_id uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, fingerprint)
);
-- A fingerprint only means anything in relation to the transaction it created
-- or merged into: deleting that transaction (directly, via asset delete, or
-- via portfolio delete — all of which cascade onto transactions) should
-- cascade away the fingerprint too, otherwise a re-imported CSV wrongly shows
-- the row as "already imported" even though the transaction is gone. Nullable
-- because rows recorded before migration 0028 have no link.
alter table public.imported_rows
  add column if not exists transaction_id uuid references public.transactions (id) on delete cascade;
-- Every transaction delete cascades onto imported_rows via transaction_id;
-- unindexed, that cascade scans the whole table.
create index if not exists imported_rows_transaction_id_idx
  on public.imported_rows (transaction_id);

-- Fingerprints of bank-statement rows already imported into spending
-- transactions (ROADMAP item #3, flag `spending`) -- mirrors imported_rows
-- above but tied to spending_transactions instead of transactions, since the
-- two entities are unrelated tables a single fingerprint table can't FK to
-- both.
create table if not exists public.imported_spending_rows (
  user_id uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,
  spending_transaction_id uuid references public.spending_transactions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, fingerprint)
);
create index if not exists imported_spending_rows_transaction_id_idx
  on public.imported_spending_rows (spending_transaction_id);

alter table public.imported_spending_rows enable row level security;

-- Household-shared (ROADMAP #13 round 3, migration 0093) so re-import
-- dedupe keeps working once spending_transactions itself is shared.
drop policy if exists "own imported spending rows" on public.imported_spending_rows;
create policy "own imported spending rows" on public.imported_spending_rows
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

-- Applied-migrations registry (system table) --------------------------------
create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
-- A fresh schema.sql install already includes every migration's effect.
insert into public.schema_migrations (version) values
  ('0001_isin_wkn_and_executed_at'),
  ('0002_instruments_catalog_and_currency'),
  ('0003_etf_constituents'),
  ('0004_country_and_dividends'),
  ('0005_yahoo_quote_source'),
  ('0006_normalize_3nf'),
  ('0007_expand_constituents'),
  ('0007_price_cache'),
  ('0007_sector_region'),
  ('0008_executed_at_naive'),
  ('0009_fx_cache_and_crypto_usd'),
  ('0010_drop_instrument_owner'),
  ('0011_asset_currency'),
  ('0012_schema_migrations'),
  ('0013_benchmark_history'),
  ('0014_etf_breakdowns'),
  ('0015_benchmark_currency'),
  ('0016_etf_country_kind'),
  ('0017_shared_portfolios'),
  ('0018_profile_name_locale'),
  ('0019_shared_live'),
  ('0020_shared_owner_delete'),
  ('0021_portfolios'),
  ('0022_instrument_history'),
  ('0023_transaction_booking'),
  ('0024_simulation_runs'),
  ('0025_app_settings'),
  ('0026_imported_rows'),
  ('0027_feature_flags'),
  ('0028_imported_rows_transaction'),
  ('0029_transaction_interest'),
  ('0030_offline_mode'),
  ('0031_shared_portfolios_hardening'),
  ('0032_instruments_dedupe'),
  ('0033_site_config'),
  ('0034_shared_portfolios_expiry'),
  ('0035_estimated_badge_flag'),
  ('0036_transaction_tax'),
  ('0037_watchlist'),
  ('0038_savings_plans'),
  ('0039_dividend_dashboard_flag'),
  ('0040_commodity_type'),
  ('0041_watchlist_currency'),
  ('0042_instrument_name_sync'),
  ('0043_rate_limit'),
  ('0044_reset_commodity_quote'),
  ('0045_fk_indexes'),
  ('0046_history_cache_flag'),
  ('0047_export_flags'),
  ('0049_drop_pays_dividends'),
  ('0050_admin_authz'),
  ('0051_error_logs'),
  ('0052_retention_indexes'),
  ('0053_heal_gold_gme_quotes'),
  ('0054_tax_settings'),
  ('0055_manual_tax_entries'),
  ('0056_profile_theme'),
  ('0057_profile_tour'),
  ('0058_portfolio_fees'),
  ('0059_portfolio_tax_allowance'),
  ('0060_profile_tours_done'),
  ('0061_savings_plan_booking_type'),
  ('0062_asset_tags'),
  ('0063_llm_chat_flag'),
  ('0064_llm_settings'),
  ('0065_plan_gating'),
  ('0066_billing'),
  ('0067_billing_admin_keys'),
  ('0068_plan_grants'),
  ('0069_error_log_levels'),
  ('0070_billing_display_prices'),
  ('0071_import_pp_flag'),
  ('0072_split_transaction_type'),
  ('0073_split_detection_flag'),
  ('0074_vorabpauschale'),
  ('0075_dividend_calendar_flag'),
  ('0076_push_notifications'),
  ('0077_cash_interest'),
  ('0078_rebalance_targets'),
  ('0079_manual_valuation'),
  ('0080_accounts'),
  ('0081_spending'),
  ('0082_imported_spending_rows'),
  ('0083_budgets'),
  ('0084_contracts'),
  ('0085_goals'),
  ('0086_fin_health_flag'),
  ('0087_fire_planner_flag'),
  ('0100_planned_cashflows'),
  ('0101_household_pro'),
  ('0102_debt_rate_schedule'),
  ('0103_repair_dropped_migrations'),
  ('0104_account_interest_and_position_goals'),
  ('0105_extra_repayments'),
  ('0106_pension'),
  ('0107_pinned_quote_listings'),
  ('0108_admin_feature_usage'),
  ('0109_fix_admin_feature_usage'),
  ('0110_drop_extra_repayments')
on conflict (version) do nothing;

-- Row-level security ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.schema_migrations enable row level security;
alter table public.assets enable row level security;
alter table public.portfolios enable row level security;
alter table public.transactions enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.savings_plans enable row level security;
alter table public.tag_groups enable row level security;
alter table public.asset_tags enable row level security;
alter table public.asset_valuations enable row level security;
alter table public.accounts enable row level security;
alter table public.account_balances enable row level security;
alter table public.pension_points enable row level security;
alter table public.pension_contracts enable row level security;
alter table public.spending_categories enable row level security;
alter table public.spending_transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.contracts enable row level security;
alter table public.planned_cashflows enable row level security;
alter table public.goals enable row level security;
alter table public.llm_settings enable row level security;
alter table public.simulation_runs enable row level security;
alter table public.imported_rows enable row level security;
alter table public.instruments enable row level security;
alter table public.instrument_constituents enable row level security;
alter table public.fx_rates enable row level security;
alter table public.benchmark_history enable row level security;
alter table public.instrument_history enable row level security;
alter table public.etf_breakdowns enable row level security;
alter table public.shared_portfolios enable row level security;

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
  for insert to authenticated
  with check (isin is not null or wkn is not null or symbol is not null);
drop policy if exists "constituents readable" on public.instrument_constituents;
create policy "constituents readable"
  on public.instrument_constituents for select using (true);
drop policy if exists "fx readable" on public.fx_rates;
create policy "fx readable" on public.fx_rates for select using (true);
drop policy if exists "benchmark history readable" on public.benchmark_history;
create policy "benchmark history readable" on public.benchmark_history for select using (true);
drop policy if exists "instrument history readable" on public.instrument_history;
create policy "instrument history readable" on public.instrument_history for select using (true);
-- Shared snapshots are world-readable by id (a share link) as long as they
-- haven't expired. Ids are random. Creation has no client-facing insert
-- policy: app/api/share/route.ts writes with the secret key and enforces the
-- size cap + rate limit itself (migration 0031 dropped the open
-- `insert with check (true)` policy). expires_at null = never expires
-- (migration 0034 — an expired row is simply invisible, no app-side branching
-- needed); a cron sweep (app/api/cron/sync/shared-portfolios) later deletes it.
drop policy if exists "shared portfolios readable" on public.shared_portfolios;
create policy "shared portfolios readable" on public.shared_portfolios
  for select using (expires_at is null or expires_at > now());
drop policy if exists "shared portfolios insertable" on public.shared_portfolios;
-- An owner may keep their own (live) shares current and delete them (so a new
-- share can void the previous links).
drop policy if exists "shared portfolios owner update" on public.shared_portfolios;
create policy "shared portfolios owner update" on public.shared_portfolios
  for update using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "shared portfolios owner delete" on public.shared_portfolios;
create policy "shared portfolios owner delete" on public.shared_portfolios
  for delete using (owner = auth.uid());
drop policy if exists "etf breakdowns readable" on public.etf_breakdowns;
create policy "etf breakdowns readable" on public.etf_breakdowns for select using (true);
drop policy if exists "migrations readable" on public.schema_migrations;
create policy "migrations readable" on public.schema_migrations for select using (true);

-- `create policy` has no IF NOT EXISTS, so drop-then-create stays idempotent.
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Household-shared (ROADMAP #13 round 3, migration 0093): see that
-- migration's module comment for the full list of what's shared vs kept
-- strictly personal (llm_settings, simulation_runs, profiles).
drop policy if exists "own portfolios" on public.portfolios;
create policy "own portfolios" on public.portfolios
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own assets" on public.assets;
create policy "own assets" on public.assets
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own watchlist" on public.watchlist_items;
create policy "own watchlist" on public.watchlist_items
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own savings plans" on public.savings_plans;
create policy "own savings plans" on public.savings_plans
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own tag groups" on public.tag_groups;
create policy "own tag groups" on public.tag_groups
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own asset valuations" on public.asset_valuations;
create policy "own asset valuations" on public.asset_valuations
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

-- Household-shared (ROADMAP #13 round 2, migration 0092): a household peer
-- can see and edit every member's accounts + balances, not just their own.
-- household_peer_ids() returns an empty set for anyone not in a household,
-- so this reduces to plain self-ownership by default.
drop policy if exists "own accounts" on public.accounts;
create policy "own accounts" on public.accounts
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own account balances" on public.account_balances;
create policy "own account balances" on public.account_balances
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

-- Pension rows are self-only, deliberately WITHOUT household_peer_ids(): a
-- statutory entitlement is personal, and the Renteninformation it is copied
-- from is one of the more sensitive documents a user owns.
drop policy if exists "own pension points" on public.pension_points;
create policy "own pension points" on public.pension_points
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own pension contracts" on public.pension_contracts;
create policy "own pension contracts" on public.pension_contracts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

-- `or created_by = auth.uid()` matters at creation time: the creator's own
-- household_members row (role owner) doesn't exist yet when they insert it,
-- so my_household_id() is still null and, without this clause, the
-- household_members INSERT policy's "did I create this household" subquery
-- below would never see the household row it just created (RLS on a plain
-- subquery is evaluated against the referencing role's own visibility, not
-- bypassed just because the row matches created_by).
drop policy if exists "member households" on public.households;
create policy "member households" on public.households
  for select using (id = public.my_household_id() or created_by = auth.uid());
drop policy if exists "create household" on public.households;
create policy "create household" on public.households
  for insert with check (created_by = auth.uid());
drop policy if exists "owner updates household" on public.households;
create policy "owner updates household" on public.households
  for update using (public.is_household_owner(id));
drop policy if exists "owner deletes household" on public.households;
create policy "owner deletes household" on public.households
  for delete using (public.is_household_owner(id));

drop policy if exists "view household members" on public.household_members;
create policy "view household members" on public.household_members
  for select using (household_id = public.my_household_id());
drop policy if exists "join household" on public.household_members;
create policy "join household" on public.household_members
  for insert with check (
    user_id = auth.uid()
    and (
      exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid())
      or exists (
        select 1 from public.household_invites i
        where i.household_id = household_members.household_id
          and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and i.status = 'pending'
      )
    )
  );
drop policy if exists "leave or owner removes member" on public.household_members;
create policy "leave or owner removes member" on public.household_members
  for delete using (user_id = auth.uid() or public.is_household_owner(household_id));
drop policy if exists "owner updates member role" on public.household_members;
create policy "owner updates member role" on public.household_members
  for update using (public.is_household_owner(household_id))
  with check (public.is_household_owner(household_id));

drop policy if exists "view own sent or received invites" on public.household_invites;
create policy "view own sent or received invites" on public.household_invites
  for select using (
    invited_by = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.is_household_owner(household_id)
  );
drop policy if exists "member creates invite" on public.household_invites;
create policy "member creates invite" on public.household_invites
  for insert with check (invited_by = auth.uid() and household_id = public.my_household_id());
drop policy if exists "invitee or owner updates invite" on public.household_invites;
create policy "invitee or owner updates invite" on public.household_invites
  for update using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.is_household_owner(household_id)
  );

drop policy if exists "own spending categories" on public.spending_categories;
create policy "own spending categories" on public.spending_categories
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own spending transactions" on public.spending_transactions;
create policy "own spending transactions" on public.spending_transactions
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own budgets" on public.budgets;
create policy "own budgets" on public.budgets
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own contracts" on public.contracts;
create policy "own contracts" on public.contracts
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own planned cashflows" on public.planned_cashflows;
create policy "own planned cashflows" on public.planned_cashflows
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own asset tags" on public.asset_tags;
create policy "own asset tags" on public.asset_tags
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

-- llm_settings deliberately stays personal (can hold a live BYO API key,
-- see migration 0093's module comment).
drop policy if exists "own llm settings" on public.llm_settings;
create policy "own llm settings" on public.llm_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own simulations" on public.simulation_runs;
create policy "own simulations" on public.simulation_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own imported rows" on public.imported_rows;
create policy "own imported rows" on public.imported_rows
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

-- Transactions are owned via their asset (no user_id column) -- this
-- subquery extends the same way the assets policy above did.
drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions for all
  using (
    asset_id in (
      select id from public.assets
      where user_id = auth.uid() or user_id in (select public.household_peer_ids())
    )
  )
  with check (
    asset_id in (
      select id from public.assets
      where user_id = auth.uid() or user_id in (select public.household_peer_ids())
    )
  );

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

-- App-wide settings (single row). `max_users` caps registrations; null = no
-- limit. The owner changes it on a moment's notice with:
--   update public.app_settings set max_users = 50;   -- or NULL to disable
-- `stripe_secret_key`/`stripe_webhook_secret` (migration 0067) let the owner
-- set Stripe credentials at runtime from /admin/billing; RLS has zero
-- policies on this table so only the service role can ever read them.
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  max_users int,
  stripe_secret_key text,
  stripe_webhook_secret text,
  -- VAPID keys for web push (F5); DB-first with an env fallback like the
  -- Stripe keys. The public key is not secret (handed to the browser).
  vapid_public_key text,
  vapid_private_key text,
  vapid_subject text,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- Web push subscriptions (COMPETITION.md F5): one row per browser/device, prefs
-- per subscription, `last_notified_on` de-dupes the daily cron. A user manages
-- only their own rows; the cron reads/writes all via the service role.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  notify_dividends boolean not null default false,
  notify_savings boolean not null default false,
  last_notified_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subs selectable" on public.push_subscriptions;
create policy "own push subs selectable" on public.push_subscriptions
  for select using (auth.uid() = user_id);
drop policy if exists "own push subs insertable" on public.push_subscriptions;
create policy "own push subs insertable" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
drop policy if exists "own push subs updatable" on public.push_subscriptions;
create policy "own push subs updatable" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own push subs deletable" on public.push_subscriptions;
create policy "own push subs deletable" on public.push_subscriptions
  for delete using (auth.uid() = user_id);
alter table public.app_settings enable row level security;

-- Whether registration is currently open (below the user cap). SECURITY DEFINER
-- so the anon login page can check without reading auth.users or app_settings
-- directly. Enforced again server-side by /api/registration-status.
create or replace function public.registration_open()
returns boolean
language sql
security definer
set search_path = public
as $$
  select case
    when (select max_users from public.app_settings where id = 1) is null then true
    else (select count(*) from auth.users)
       < (select max_users from public.app_settings where id = 1)
  end;
$$;
grant execute on function public.registration_open() to anon, authenticated;

-- Feature flags. A flag has a global default in `feature_flags`
-- (world-readable) that the owner flips via SQL/dashboard:
--   update public.feature_flags set enabled = false where flag = 'xray';
-- and an optional per-user override in `user_feature_flags` that wins over
-- the global value:
--   insert into public.user_feature_flags (user_id, flag, enabled)
--   values ('<auth.users uuid>', 'xray', true)
--   on conflict (user_id, flag) do update set enabled = excluded.enabled;
-- Both tables are written by the owner only (service role / dashboard —
-- bypasses RLS); clients read, never write. A flag missing from the table
-- counts as enabled.
create table if not exists public.feature_flags (
  flag text primary key,
  enabled boolean not null default true,
  description text,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_feature_flags (
  user_id uuid not null references auth.users (id) on delete cascade,
  flag text not null references public.feature_flags (flag) on delete cascade,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, flag)
);
-- Cascade path from feature_flags deletes; the primary key (user_id, flag)
-- does not cover flag-leading lookups.
create index if not exists user_feature_flags_flag_idx
  on public.user_feature_flags (flag);

alter table public.feature_flags enable row level security;
alter table public.user_feature_flags enable row level security;

drop policy if exists "feature flags readable" on public.feature_flags;
create policy "feature flags readable" on public.feature_flags
  for select using (true);
drop policy if exists "own feature flag overrides readable" on public.user_feature_flags;
create policy "own feature flag overrides readable" on public.user_feature_flags
  for select using (auth.uid() = user_id);

insert into public.feature_flags (flag, description) values
  ('csvImport', 'Broker CSV transaction import'),
  ('risk', 'Analysis — Risk section'),
  ('xray', 'X-Ray ETF look-through'),
  ('rebalance', 'Rebalancing'),
  ('simulation', 'Monte Carlo simulation (whole feature)'),
  ('simulationPortfolio', 'Simulation — My portfolio mode'),
  ('simulationCustom', 'Simulation — Custom mode'),
  ('simulationWithdrawal', 'Simulation — Withdrawal phase'),
  ('offline', 'Offline mode (read-only app shell + last-known data)'),
  ('estimated-badge', 'Estimated badge on synthetic/fabricated prices & charts'),
  ('taxReport', 'Analysis — annual tax report (realized gains, fees, taxes per year)'),
  ('watchlist', 'Watchlist card on the dashboard'),
  ('savingsPlans', 'Savings plans (recurring buys) card on the dashboard'),
  ('dividends', 'Dividend dashboard (/dividends)'),
  ('historyCache', 'Client-side stale-while-revalidate cache of historical price series (instant chart repaint on repeat visits)'),
  ('exportCsv', 'Portfolio export — Download CSV'),
  ('exportJson', 'Portfolio export — Download JSON'),
  ('errorLogging', 'Server-side capture of client error reports'),
  ('importPp', 'CSV import — Portfolio Performance format'),
  ('splitDetection', 'Automatic stock split detection + review on asset detail'),
  ('vorabEstimate', 'Vorabpauschale estimate on the annual tax report'),
  ('dividendCalendar', 'Announced dividend calendar (confirmed upcoming ex/pay dates)')
on conflict (flag) do nothing;

-- Seeded DISABLED (separate insert so the default-true column doesn't enable
-- it): the AI assistant chat ships off; the owner flips it on via SQL.
insert into public.feature_flags (flag, enabled, description) values
  ('llmChat', false, 'AI assistant chat (bring-your-own LLM API key)')
on conflict (flag) do nothing;

-- Seeded DISABLED (MONETIZATION.md Phase 1): the owner flips it on once
-- Stripe webhooks are verified live.
insert into public.feature_flags (flag, enabled, description) values
  ('billing', false, 'Stripe subscription billing (Checkout, portal, Pro plan)')
on conflict (flag) do nothing;

-- Seeded DISABLED: web push ships off until the owner sets VAPID keys.
insert into public.feature_flags (flag, enabled, description) values
  ('pushNotifications', false, 'Web push reminders (dividend pay-day, savings-plan due)')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('cashInterest', false, 'Interest-bearing cash (annual rate + accrual review on CASH assets)')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('manualValuation', false, 'Manual-valuation OTHER assets (real estate, collectibles) with user-entered valuation points')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('accounts', false, 'Balance accounts & liabilities (checking/savings/credit/loan/mortgage) folded into net worth')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('spending', false, 'Categorised expense/income transactions against balance accounts')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('budgets', false, 'Monthly per-category spending caps with budget-vs-actual bars')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('contracts', false, 'Recurring-charge detection and a contract/subscription register')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('plannedCashflow', false, 'Planned income & expenses (salary, bonus, one-off costs) with due-booking review and a months-ahead cash-flow forecast')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('goals', false, 'Named savings goals with progress tracking, linked to an account or entered manually')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('finHealth', false, 'Financial-health gauges: months-of-expenses covered, savings rate, debt-to-income, net-worth-to-income')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('firePlanner', false, 'Retirement / FIRE planner: lean/regular/fat FIRE numbers, years-to-FI, and a withdrawal-rate Monte Carlo run')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('debtPayoff', false, 'Debt payoff planner: amortisation schedules and an avalanche/snowball extra-payment simulator for liability accounts')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('insurance', false, 'Insurance register (typed contracts: type + sum insured) with coverage-gap prompts')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('taxPack', false, 'Tax pack: deductible-expense tagging on spending categories + a year-end advisor/Elster export')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('pension', false, 'Retirement provision: statutory Entgeltpunkte + Rentenniveau tracking and private/company pension policies, projected to a monthly retirement income')
on conflict (flag) do nothing;
insert into public.feature_flags (flag, enabled, description) values
  ('household', false, 'Household collaboration: shared households with invite/accept, and household-peer access to accounts (more entities follow in later rounds)')
on conflict (flag) do nothing;

-- Plan gating (MONETIZATION.md Phase 2, dark launch — every flag stays
-- 'free' here; the owner tiers a flag to Pro later via /admin/flags, no
-- migration needed). `plan_limits` holds the free/pro quantity caps for
-- watchlist items, savings plans and portfolios (null = unlimited).
alter table public.feature_flags
  add column if not exists required_plan text not null default 'free';
alter table public.feature_flags
  drop constraint if exists feature_flags_required_plan_check;
alter table public.feature_flags
  add constraint feature_flags_required_plan_check check (required_plan in ('free', 'pro'));

create table if not exists public.plan_limits (
  limit_key text primary key,
  free_value integer,
  pro_value integer,
  updated_at timestamptz not null default now()
);
alter table public.plan_limits enable row level security;
drop policy if exists "plan limits readable" on public.plan_limits;
create policy "plan limits readable" on public.plan_limits
  for select using (true);

insert into public.plan_limits (limit_key, free_value, pro_value) values
  ('watchlistItems', null, null),
  ('savingsPlans', null, null),
  ('portfolios', null, null),
  -- People in a household, including yourself (migration 0101).
  ('householdMembers', null, null)
on conflict (limit_key) do nothing;

-- Site-wide public config, starting with the operator identity shown on the
-- legal pages (/impressum, /datenschutz). Same shape/policy as feature_flags:
-- world-readable, owner writes only via SQL/dashboard. A key missing or empty
-- means "not filled in yet"; the UI falls back to a placeholder.
create table if not exists public.site_config (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.site_config enable row level security;
drop policy if exists "site config readable" on public.site_config;
create policy "site config readable" on public.site_config
  for select using (true);
insert into public.site_config (key, value) values
  ('legal_name', ''),
  ('legal_street', ''),
  ('legal_city', ''),
  ('legal_email', '')
on conflict (key) do nothing;

-- Billing (MONETIZATION.md Phase 1): Stripe subscriptions, redirect-based
-- integration (Checkout + Billing portal, no on-page Stripe JS) so CSP
-- connect-src stays untouched; every table here is written only by the
-- webhook / reconcile cron via the service role, never by the client.
-- `billing_config` holds the price ids (config-in-DB, like `site_config`) so
-- the owner can change prices or disable selling without a redeploy.

-- 1:1 user <-> Stripe customer.
create table if not exists public.billing_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

-- Mirror of the Stripe subscription state; written ONLY by the webhook /
-- reconcile cron (service role). Client reads its own row.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_subscription_id text not null unique,
  status text not null,              -- Stripe status verbatim
  plan text not null default 'pro',  -- derived from price id
  price_id text not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Webhook idempotency ledger (Stripe retries; replays must be no-ops). A
-- retention cron prunes rows older than 30 days (existing retention pattern).
create table if not exists public.stripe_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;

-- Select-own only, no client insert/update/delete policies (service role
-- bypasses RLS; writes happen only server-side via the webhook/cron).
drop policy if exists "own billing customer" on public.billing_customers;
create policy "own billing customer" on public.billing_customers
  for select using (auth.uid() = user_id);
drop policy if exists "own subscription" on public.subscriptions;
create policy "own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

-- stripe_events has RLS enabled and no policies at all: not even the owning
-- user can read it, it is a server-only idempotency ledger.

-- Single-row config for Stripe price ids, world-readable, owner-written only
-- (same shape as app_settings/site_config). Prices are null until the owner
-- fills them in; `enabled` gates selling independently of the `billing` flag.
-- `price_monthly_display`/`price_yearly_display` (migration 0070) are the
-- owner-typed strings shown on the /pricing marketing page (e.g. "4,99
-- EUR") -- free text, never formatted or computed with, distinct from the
-- Stripe price ids above.
create table if not exists public.billing_config (
  id integer primary key check (id = 1),
  price_monthly text,
  price_yearly text,
  price_monthly_display text,
  price_yearly_display text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.billing_config enable row level security;
drop policy if exists "billing config readable" on public.billing_config;
create policy "billing config readable" on public.billing_config
  for select using (true);

insert into public.billing_config (id, price_monthly, price_yearly, enabled) values
  (1, null, null, false)
on conflict (id) do nothing;

-- "Gratitude premium" (MONETIZATION.md): grant a user Pro independent of any
-- Stripe subscription, with an optional end date or no expiry at all.
-- Written only by the service role (owner tooling, admin API lands in a
-- later round) -- same posture as `subscriptions`: the client can only read
-- its own rows. `resolvePlan` (lib/billing/plan.ts) treats an active grant
-- as an independent path to "pro", alongside the existing Stripe path.
create table if not exists public.plan_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null default 'pro',
  expires_at timestamptz,  -- null = infinite
  note text,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists plan_grants_user_id_idx on public.plan_grants (user_id);

alter table public.plan_grants enable row level security;

drop policy if exists "own plan grants" on public.plan_grants;
create policy "own plan grants" on public.plan_grants
  for select using (auth.uid() = user_id);

-- Household sharing is a paid family plan (migration 0101) -------------------
--
-- Sharing is enforced by RLS (household_peer_ids(), used by every
-- household-shared policy above), and RLS knew nothing about plans: tiering
-- the `household` flag to 'pro' only hid the /household page client-side,
-- while every shared row stayed visible on the dashboard, /spending and
-- /goals after a downgrade. This block moves the gate to where the sharing
-- actually happens.
--
-- Shape: ONE Pro subscription per household, members free. The gate is
-- therefore per-HOUSEHOLD ("does at least one member have Pro"), never
-- per-member, and re-evaluated on every read rather than only at join time.
-- It is conditional on the flag's own tier, so with every flag seeded
-- required_plan = 'free' nothing locks until the owner re-tiers the row on
-- /admin/flags -- one toggle then flips both the teaser and this enforcement.
--
-- These functions read plan_grants/subscriptions/feature_flags, which is why
-- they sit here and not next to the other household helpers: a SQL function
-- body is validated at creation time, so it cannot reference a table that a
-- fresh install has not created yet.

-- Mirrors resolvePlan (lib/billing/plan.ts) exactly: active/trialing, a 7-day
-- past_due grace, plus a standalone plan_grants path. The subscription branch
-- ignores `subscriptions.plan` because resolvePlan does; the grant branch
-- requires plan = 'pro' because resolvePlan does. Keep the two in step -- one
-- rule, expressed once for the client and once for RLS.
create or replace function public.user_has_pro(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.plan_grants g
    where g.user_id = p_user_id
      and g.plan = 'pro'
      and (g.expires_at is null or g.expires_at > now())
  ) or exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and (
        s.status in ('active', 'trialing')
        or (s.status = 'past_due' and now() < s.current_period_end + interval '7 days')
      )
  );
$$;
-- Never client-callable (and revoked from the PUBLIC default): it would let
-- any signed-in user probe whether an arbitrary user id pays. The
-- security-definer functions below run as the owner and need no grant.
revoke execute on function public.user_has_pro(uuid) from public;

-- Is the household tier being sold right now? A missing row or a lagging
-- migration reads as 'free' => no gate, the same fail-open default the rest of
-- the flag/limit resolution uses.
create or replace function public.household_pro_required()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select required_plan = 'pro' from public.feature_flags where flag = 'household'),
    false
  );
$$;
revoke execute on function public.household_pro_required() from public;

create or replace function public.household_has_pro(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = p_household_id and public.user_has_pro(hm.user_id)
  );
$$;
revoke execute on function public.household_has_pro(uuid) from public;

-- The single predicate every sharing path consults.
create or replace function public.household_sharing_enabled(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_household_id is not null
    and (not public.household_pro_required() or public.household_has_pro(p_household_id));
$$;
revoke execute on function public.household_sharing_enabled(uuid) from public;

-- Client-readable aggregate for the caller's OWN household only, so /household
-- can say "sharing is paused, nobody here has Pro" instead of silently showing
-- two disconnected datasets (owner rule: never leave a failed state looking
-- like a normal one). It discloses only whether the caller's own household
-- shares, never which member pays.
create or replace function public.household_sharing_active()
returns boolean language sql stable security definer set search_path = public as $$
  select public.household_sharing_enabled(public.my_household_id());
$$;
grant execute on function public.household_sharing_active() to authenticated;

-- The enforcement point, replacing the plain version defined next to the other
-- household helpers. An empty set collapses every household-shared policy back
-- to plain self-ownership: nothing is deleted or reassigned, both members
-- simply see their own data again until someone subscribes.
create or replace function public.household_peer_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  with mine as (
    select household_id from public.household_members where user_id = auth.uid() limit 1
  )
  select hm.user_id
  from public.household_members hm
  join mine on mine.household_id = hm.household_id
  where public.household_sharing_enabled(mine.household_id);
$$;
grant execute on function public.household_peer_ids() to authenticated;

-- Joining needs Pro somewhere too, otherwise a free pair sits in a household
-- that shares nothing and looks broken. Either side may carry it: the
-- creator/owner (the normal case) or the person accepting the invite (a Pro
-- user joining their partner's free account) -- household_peer_ids keeps the
-- invariant "at least one member has Pro" true either way.
drop policy if exists "join household" on public.household_members;
create policy "join household" on public.household_members
  for insert with check (
    user_id = auth.uid()
    and (
      exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid())
      or exists (
        select 1 from public.household_invites i
        where i.household_id = household_members.household_id
          and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and i.status = 'pending'
      )
    )
    and (
      not public.household_pro_required()
      or public.user_has_pro(auth.uid())
      or public.household_has_pro(household_id)
    )
  );

-- Fail loudly at invite time rather than creating invitations that could never
-- lead to sharing.
drop policy if exists "member creates invite" on public.household_invites;
create policy "member creates invite" on public.household_invites
  for insert with check (
    invited_by = auth.uid()
    and household_id = public.my_household_id()
    and public.household_sharing_enabled(household_id)
  );

-- Owner-curated quote listing (migration 0107): the price cron reuses quote_id
-- verbatim and never re-resolves or overwrites it. One ISIN has listings in
-- several currencies, and the daily self-heal (which drops the hint so a stuck
-- quote_id can recover -- the GME case) re-resolved VWCE's seeded EUR Xetra
-- line to the USD London one and wrote it over the seed. Currency cannot tell
-- a good hint from a bad one (GME's wrong listing was in the right currency);
-- provenance can.
alter table public.instruments add column if not exists quote_pinned boolean not null default false;

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

-- Every listing above was picked by hand -- notably VWCE.DE (EUR Xetra) and
-- IWDA.AS (EUR Amsterdam) rather than their USD London lines -- so none of
-- them may be replaced by a Yahoo search result. See migration 0107.
update public.instruments set quote_pinned = true
  where isin in ('IE00BK5BQT80', 'IE00B4L5Y983')
     or symbol in ('AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA', 'SPY');

-- Gold seed, kept as a separate insert so the shared column list above (which
-- has no quote_scale) doesn't have to be widened for every existing row.
-- Quoted per troy ounce (GC=F, COMEX gold futures, USD - Yahoo delisted the
-- original XAUEUR=X listing, see migration 0053); quote_scale converts to
-- per-gram (1 / 31.1034768 ~= 0.0321507466), the instrument's native display
-- unit, applied after the USD->EUR FX conversion.
insert into public.instruments
  (symbol, name, type, currency, quote_source, quote_id, base_price, drift, vol, dividend_yield, quote_scale)
values
  ('XAU', 'Gold', 'COMMODITY', 'EUR', 'yahoo', 'GC=F', 115, 0.03, 0.16, 0, 0.0321507466)
on conflict (symbol) where symbol is not null do nothing;

-- COMMODITY listings were already authoritative in the cron's code; the flag
-- makes that the same rule as the pinned rows above rather than a second one.
update public.instruments set quote_pinned = true
  where type = 'COMMODITY' and quote_id is not null;

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

-- Admin authz foundation (migration 0050) -----------------------------------
-- An explicit allowlist table (no role/claim hacks), a SECURITY DEFINER
-- helper other policies can call, and an audit trail for admin-performed
-- mutations. No seed row here on purpose: the operator adds their own
-- auth.users id post-deploy:
--   insert into public.admins (user_id) values ('<auth.users uuid>');
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- A user may only ever see whether THEY are an admin (used by the client's
-- useIsAdmin hook to gate the /admin shell), never the full admin list.
drop policy if exists "own admin row" on public.admins;
create policy "own admin row" on public.admins for select using (user_id = auth.uid());

-- SECURITY DEFINER so it can be referenced from other tables' RLS policies
-- without those policies needing their own read access to public.admins.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_email text,
  action text not null,
  target text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
drop policy if exists "admin audit readable" on public.admin_audit;
create policy "admin audit readable" on public.admin_audit for select using (public.is_admin());
create index if not exists admin_audit_created_at_idx on public.admin_audit (created_at desc);

-- Self-hosted error-log pipeline (migration 0051; levels added in 0069) ----
-- Client error boundaries and a window-level error/unhandledrejection
-- listener report here via POST /api/errors (flag-gated, rate-limited, no
-- user id / IP stored). Admins browse via /admin/errors under RLS below; a
-- 30-day retention cron (app/api/cron/sync/error-logs) purges old rows.
-- `kind` (boundary/window/unhandledrejection) is the capture source, a
-- secondary display column; `level` (debug|info|warn|error|fatal) is the
-- primary severity classification and the /admin/errors filter.
create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'boundary',
  level text not null default 'error',
  message text,
  stack text,
  route text,
  digest text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.error_logs enable row level security;
drop policy if exists "error logs admin readable" on public.error_logs;
create policy "error logs admin readable" on public.error_logs for select using (public.is_admin());
create index if not exists error_logs_created_at_idx on public.error_logs (created_at desc);
create index if not exists error_logs_level_idx on public.error_logs (level);
alter table public.error_logs drop constraint if exists error_logs_level_check;
alter table public.error_logs add constraint error_logs_level_check
  check (level in ('debug', 'info', 'warn', 'error', 'fatal'));

-- Admin feature usage ---------------------------------------------------------
-- Feature usage for the admin area: how many users actually USE each feature,
-- and how much they have in it.
--
-- Deliberately NOT an event tracker. Nothing new is collected, no action is
-- logged, no cookie is set: the figures are aggregates over rows the user
-- already stored, computed on demand. That keeps the privacy policy's promise
-- ("no analytics or tracking services") true while still answering "is anyone
-- using the pension planner".
--
-- SECURITY DEFINER because the per-user tables are RLS-scoped to their owner;
-- the function itself is admin-only (public.is_admin(), the same predicate the
-- admin RLS policies use) and returns COUNTS ONLY, never a row's contents.

create or replace function public.admin_feature_usage()
returns table (feature text, users bigint, records bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Two callers, two identities: the browser (an admin's own JWT, checked with
  -- is_admin()) and the server route (the secret key, whose auth.uid() is NULL
  -- and would fail that check). Without the service_role arm the API route
  -- backing /admin/usage could never read its own function.
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select 'assets'::text, count(distinct a.user_id), count(*)::bigint from public.assets a
    -- `transactions` hangs off the user through its asset, it has no user_id
    -- of its own.
    union all select 'transactions', count(distinct a2.user_id), count(*)::bigint
      from public.transactions t join public.assets a2 on a2.id = t.asset_id
    union all select 'watchlist', count(distinct w.user_id), count(*)::bigint from public.watchlist_items w
    union all select 'savingsPlans', count(distinct s.user_id), count(*)::bigint from public.savings_plans s
    union all select 'tags', count(distinct g.user_id), count(*)::bigint from public.tag_groups g
    union all select 'accounts', count(distinct ac.user_id), count(*)::bigint from public.accounts ac
    union all select 'accountBalances', count(distinct ab.user_id), count(*)::bigint from public.account_balances ab
    union all select 'spending', count(distinct st.user_id), count(*)::bigint from public.spending_transactions st
    union all select 'spendingCategories', count(distinct sc.user_id), count(*)::bigint from public.spending_categories sc
    union all select 'recurring', count(distinct c.user_id), count(*)::bigint from public.contracts c
    union all select 'plannedCashflow', count(distinct pc.user_id), count(*)::bigint from public.planned_cashflows pc
    union all select 'goals', count(distinct go.user_id), count(*)::bigint from public.goals go
    union all select 'pensionPoints', count(distinct pp.user_id), count(*)::bigint from public.pension_points pp
    union all select 'pensionContracts', count(distinct pk.user_id), count(*)::bigint from public.pension_contracts pk
    union all select 'llm', count(distinct l.user_id), count(*)::bigint from public.llm_settings l
    union all select 'push', count(distinct ps.user_id), count(*)::bigint from public.push_subscriptions ps
    union all select 'imports', count(distinct ir.user_id), count(*)::bigint from public.imported_rows ir
    -- A share link is owned by `owner`, not `user_id`, and an anonymous guest
    -- share has no owner at all -- those count as records without a user.
    union all select 'sharing', count(distinct sp.owner), count(*)::bigint from public.shared_portfolios sp
    union all select 'proGrants', count(distinct pg.user_id), count(*)::bigint from public.plan_grants pg;
end;
$$;

grant execute on function public.admin_feature_usage() to authenticated;
