-- Debt payoff (ROADMAP item #9, flag `debtPayoff`): liability accounts (#1)
-- gain amortisation. `interest_rate` (annual %, e.g. 4.5) and `min_payment`
-- (native currency) are optional per-account fields -- only entered once the
-- user wants an amortisation schedule for a liability account; the
-- avalanche/snowball payoff simulator itself is pure (lib/finance/debt.ts),
-- so no new table is needed.
alter table public.accounts
  add column if not exists interest_rate numeric;
alter table public.accounts
  add column if not exists min_payment numeric;

-- Seeded DISABLED (dark-launched): the /debt payoff planner only appears
-- once the owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('debtPayoff', false, 'Debt payoff planner: amortisation schedules and an avalanche/snowball extra-payment simulator for liability accounts')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0088_debt_payoff')
on conflict (version) do nothing;
