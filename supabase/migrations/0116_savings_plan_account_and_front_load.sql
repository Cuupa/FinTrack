-- Savings plans that debit a bank account, and the Ausgabeaufschlag of an
-- actively managed fund.
--
-- Two features, one migration, because they meet on the same row: booking a due
-- savings-plan execution now writes the depot transaction AND, when a
-- Verrechnungskonto is set, the matching bank booking — and the surcharge is
-- exactly what makes those two amounts differ from `units x price`.
--
-- All four columns are nullable with no default, so every existing row keeps
-- behaving as before: no account link, no surcharge.

-- The account a due execution is debited from. `on delete set null`: losing the
-- account must not delete the savings plan — the depot side is what the plan is
-- for, the bank link is the optional half of it.
alter table public.savings_plans
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

-- Ausgabeaufschlag in percent for THIS plan, overriding the fund's own rate.
-- Brokers routinely discount it on savings plans while the prospectus rate
-- still applies to a manual purchase, so one number on the asset cannot say
-- both. Null = inherit `assets.front_load`.
alter table public.savings_plans
  add column if not exists front_load numeric;

-- The fund's own Ausgabeaufschlag in percent (5 = 5%). On the user's asset row
-- rather than the shared `instruments` catalog: what you pay is a property of
-- your purchase route, and one user's discounted fund must never rewrite
-- everybody else's reference data.
alter table public.assets
  add column if not exists front_load numeric;

-- The savings-plan execution a bank booking paid for. Its own column rather
-- than reusing recurring_id/planned_id: both are foreign keys into other
-- tables, and one nullable column cannot reference three. Rows carrying it are
-- transfers, not spending (`isTransfer` in lib/finance/spending.ts).
alter table public.spending_transactions
  add column if not exists savings_plan_id uuid references public.savings_plans (id) on delete set null;

-- Lookup/cascade paths for the two new foreign keys.
create index if not exists savings_plans_account_id_idx on public.savings_plans (account_id);
create index if not exists spending_transactions_savings_plan_id_idx
  on public.spending_transactions (savings_plan_id);
