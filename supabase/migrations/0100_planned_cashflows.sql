-- Planned income & expenses (flag `plannedCashflow`): the salary landing at the
-- end of the month, a bonus, a tax refund, or a one-off expense the user
-- already knows about. Sibling of `contracts`, not an extension of it: a
-- contract is always money going out and has no ONCE cadence and no end date,
-- and the recurring-charge detector is built for expenses only.
--
-- `amount` is SIGNED (income positive, expense negative) and in the ACCOUNT's
-- native currency, mirroring spending_transactions rather than
-- contracts/budgets (which are base-currency magnitudes), so booking a due
-- occurrence is a straight copy.
--
-- account_id cascades, unlike contracts.account_id's set null: the account is
-- where the money lands and where the currency comes from, so a planned
-- cashflow without it means nothing. transfer_account_id is optional and only
-- set null.
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

create index if not exists planned_cashflows_user_id_idx
  on public.planned_cashflows (user_id);
create index if not exists planned_cashflows_account_id_idx
  on public.planned_cashflows (account_id);
create index if not exists planned_cashflows_category_id_idx
  on public.planned_cashflows (category_id);
create index if not exists planned_cashflows_transfer_account_id_idx
  on public.planned_cashflows (transfer_account_id);

-- Which planned cashflow posted a booking. A column of its own rather than
-- reusing recurring_id: that one is a foreign key to contracts, and one
-- nullable column cannot reference two tables. Set null on delete, so the
-- booking (real money that moved) survives its plan.
alter table public.spending_transactions
  add column if not exists planned_id uuid references public.planned_cashflows (id) on delete set null;
create index if not exists spending_transactions_planned_id_idx
  on public.spending_transactions (planned_id);

alter table public.planned_cashflows enable row level security;
drop policy if exists "own planned cashflows" on public.planned_cashflows;
create policy "own planned cashflows" on public.planned_cashflows
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

-- Seeded DISABLED like every other feature of this size: the owner switches it
-- on once the surface has been walked on prod.
insert into public.feature_flags (flag, enabled, description) values
  ('plannedCashflow', false, 'Planned income & expenses (salary, bonus, one-off costs) with due-booking review and a months-ahead cash-flow forecast')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0100_planned_cashflows')
on conflict (version) do nothing;
