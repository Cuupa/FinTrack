-- The Renteninformation as the letter is actually written: a CUMULATIVE total
-- at a date, and nothing per year. The year-by-year split only exists in the
-- Versicherungsverlauf, which most people never request, so asking for annual
-- Entgeltpunkte asks for a figure the user does not have -- and typing the
-- letter's total into a year's row made the projection read it as an annual
-- rate. Several letters give the accrual rate honestly: the difference between
-- two totals over the years between them.
--
-- Sibling of `pension_points` (which stays for anyone who does have the
-- Versicherungsverlauf), same keying, same RLS.
create table if not exists public.pension_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  year int not null,
  total_points numeric not null,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists pension_statements_unique_key
  on public.pension_statements (user_id, year);
create index if not exists pension_statements_user_id_idx
  on public.pension_statements (user_id);

alter table public.pension_statements enable row level security;
drop policy if exists "own pension statements" on public.pension_statements;
create policy "own pension statements" on public.pension_statements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
