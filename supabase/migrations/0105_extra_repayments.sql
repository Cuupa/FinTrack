-- Planned one-off repayments on a liability (Sondertilgungen), flag
-- `debtPayoff`. A debt could only be modelled as "balance, rate, one monthly
-- instalment", so the bonus that goes into the mortgage every June or the
-- inheritance that clears the car loan had nowhere to live -- and the payoff
-- date the planner showed was years off for anyone who pays like that.
--
-- Shaped exactly like account_balances (its sibling dated-per-account table):
-- one row per dated amount, replace-set on write, native-currency magnitude,
-- attributed to the ACCOUNT's owner rather than the acting household editor.
-- It is a PLANNING input, not a booking: nothing here moves a balance, the
-- amortisation applies it in the month it falls due (lib/finance/debt.ts).
-- A repayment already made is already inside the balance, which is why the
-- schedule ignores anything dated before its start.
create table if not exists public.account_extra_repayments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  paid_on date not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);

-- One planned lump sum per account and date: the editor upserts by date, so a
-- second amount for the same day replaces the first rather than stacking.
create unique index if not exists account_extra_repayments_unique_key
  on public.account_extra_repayments (account_id, paid_on);
create index if not exists account_extra_repayments_account_id_idx
  on public.account_extra_repayments (account_id);
create index if not exists account_extra_repayments_user_id_idx
  on public.account_extra_repayments (user_id);

alter table public.account_extra_repayments enable row level security;
drop policy if exists "own extra repayments" on public.account_extra_repayments;
create policy "own extra repayments" on public.account_extra_repayments
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

insert into public.schema_migrations (version) values ('0105_extra_repayments')
on conflict (version) do nothing;
