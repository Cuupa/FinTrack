-- Interest-bearing cash (COMPETITION.md F7, closes G8): a CASH asset may carry
-- an annual nominal interest rate (percent) and a compounding frequency
-- (MONTHLY | QUARTERLY | ANNUAL). Interest accrues off the transaction log and
-- is booked as INTEREST transactions after an explicit review, mirroring
-- savings plans (lib/finance/cash-interest.ts). Both fields are per-holding and
-- null on non-cash / non-interest-bearing balances.
alter table public.assets add column if not exists interest_rate numeric;
alter table public.assets add column if not exists interest_frequency text;

-- Seeded DISABLED (dark-launched): the config UI + accrual review only appear
-- once the owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('cashInterest', false, 'Interest-bearing cash (annual rate + accrual review on CASH assets)')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0077_cash_interest')
on conflict (version) do nothing;
