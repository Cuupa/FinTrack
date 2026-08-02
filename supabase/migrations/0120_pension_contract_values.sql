-- A policy's value over time, so its return can be MEASURED instead of typed.
--
-- The old form asked for an "expected return in percent" -- a figure no
-- insurer's statement states and no user has. What they do have is the annual
-- statement: what the policy was worth on a date. Two of those plus the
-- premiums in between are an XIRR, which is the return the policy actually
-- earned rather than one guessed at.
--
-- Sibling of `account_balances`: one dated reading per row, keyed by date,
-- replace-set per policy from the app.
create table if not exists public.pension_contract_values (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contract_id uuid not null references public.pension_contracts (id) on delete cascade,
  valued_on date not null,
  value numeric not null,
  created_at timestamptz not null default now()
);
create unique index if not exists pension_contract_values_unique_key
  on public.pension_contract_values (contract_id, valued_on);
create index if not exists pension_contract_values_user_id_idx
  on public.pension_contract_values (user_id);

alter table public.pension_contract_values enable row level security;
drop policy if exists "own pension contract values" on public.pension_contract_values;
create policy "own pension contract values" on public.pension_contract_values
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
