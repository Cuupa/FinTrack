-- Statutory + private retirement provision (flag `pension`).
--
-- The app could already project a FIRE number from the portfolio, but the
-- largest retirement asset most German users have is not in it: the statutory
-- entitlement, which is denominated in Entgeltpunkte and not in euro. Points
-- cannot be turned into euro without the aktueller Rentenwert, so that pair
-- (Rentenwert + Rentenniveau) is seeded here as world-readable REFERENCE data
-- exactly like `basiszins` -- never hardcoded in the finance core.
--
-- Three pieces, deliberately shaped differently from each other:
--   * pension_reference  -- owner-written reference data, world-readable
--   * pension_points     -- the user's Renteninformation, keyed by YEAR so a
--                           year can never be recorded twice (replace-set,
--                           the same reason account_balances is keyed by date)
--   * pension_contracts  -- private/company policies, a normal id-keyed table
-- plus profiles.pension_settings, a jsonb blob for the four projection
-- assumptions, for the same reason rebalance_targets is one: one row per user
-- of a handful of scalars, and a table would mean four more store methods.

-- Aktueller Rentenwert (gross monthly euro per Entgeltpunkt) and the
-- Sicherungsniveau vor Steuern, per year. Both are set by the annual
-- Rentenwertbestimmungsverordnung and take effect on 1 July, so the row for a
-- year is the value in force in its second half; the finance layer reads it
-- carry-forward. West/East were separate until they converged on 2024-07-01;
-- the seeded values are the West figures, which have been the only ones since.
create table if not exists public.pension_reference (
  year int primary key,
  pension_value numeric not null,
  level_pct numeric,
  note text
);
alter table public.pension_reference enable row level security;
drop policy if exists "pension reference readable" on public.pension_reference;
create policy "pension reference readable" on public.pension_reference for select using (true);
insert into public.pension_reference (year, pension_value, level_pct, note) values
  (2018, 32.03, 48.1, 'Rentenwert West ab 01.07.2018'),
  (2019, 33.05, 48.2, 'Rentenwert West ab 01.07.2019'),
  (2020, 34.19, 48.2, 'Rentenwert West ab 01.07.2020'),
  (2021, 34.19, 49.4, 'Rentenwert West ab 01.07.2021 (keine Erhoehung)'),
  (2022, 36.02, 48.1, 'Rentenwert West ab 01.07.2022'),
  (2023, 37.60, 48.2, 'Rentenwert West ab 01.07.2023'),
  (2024, 39.32, 48.1, 'Rentenwert ab 01.07.2024 (Ost/West vereinheitlicht)'),
  (2025, 40.79, 48.0, 'Rentenwert ab 01.07.2025')
on conflict (year) do nothing;

-- One year of the user's own record, copied from their Renteninformation.
-- Unique per (user, year): the editor replace-sets the whole set, so a
-- replayed offline write is idempotent and a year cannot appear twice.
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

alter table public.pension_points enable row level security;
drop policy if exists "own pension points" on public.pension_points;
create policy "own pension points" on public.pension_points
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A retirement policy that PAYS a monthly pension: private Rentenversicherung,
-- Riester, Ruerup, a company scheme. A sibling of `contracts`, not one of its
-- insurance types: a contract is money going out every month, this is defined
-- by the income it will pay from a date decades away.
--
-- Deliberately NOT shared with household peers (unlike accounts): a pension
-- entitlement is personal, and the Renteninformation it is copied from is one
-- of the more sensitive documents a user owns.
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

alter table public.pension_contracts enable row level security;
drop policy if exists "own pension contracts" on public.pension_contracts;
create policy "own pension contracts" on public.pension_contracts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The four projection assumptions (birth year, planned retirement age, points
-- assumed per remaining year, target monthly pension).
alter table public.profiles add column if not exists pension_settings jsonb not null
  default '{"birthYear":null,"retirementAge":null,"annualPoints":null,"targetMonthly":null}'::jsonb;

insert into public.feature_flags (flag, enabled, description) values
  ('pension', false, 'Retirement provision: statutory Entgeltpunkte + Rentenniveau tracking and private/company pension policies, projected to a monthly retirement income')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0106_pension')
on conflict (version) do nothing;
