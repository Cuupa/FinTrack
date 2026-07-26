-- Repair: re-apply the DDL of two migrations that were deleted from the repo
-- before every database had run them.
--
-- Migrations 0001-0097 were removed in a housekeeping commit while
-- supabase/schema.sql kept their columns. A fresh install is therefore fine
-- (schema.sql is canonical), but a database that had NOT yet run 0096/0097
-- lost the only way to get those columns -- and PostgREST answers a missing
-- column with PGRST204, which surfaced as "Der Vertrag konnte nicht
-- gespeichert werden" the moment a contract pointed at a target account:
--
--   Could not find the 'target_account_id' column of 'contracts'
--   in the schema cache (PGRST204)
--
-- Every statement is `if not exists`, so a database that already ran the
-- originals is untouched. Lesson: schema.sql is not a delivery mechanism for
-- an EXISTING database, only migrations are -- never delete a migration file
-- on the grounds that schema.sql still describes its result.

-- ---------------------------------------------------------------------------
-- from 0096_transfers.sql: recurring charges that are not consumption (a loan
-- instalment, a wealth-building premium). `transfer_account_id` marks a
-- booking as a transfer so lib/finance/spending.ts skips it in every
-- aggregation; `contracts.target_account_id` is what makes a contract post
-- them. Both `on delete set null`: losing the far account must not delete the
-- booking (it happened) nor the contract.
-- ---------------------------------------------------------------------------
alter table public.spending_transactions
  add column if not exists transfer_account_id uuid references public.accounts (id) on delete set null;

alter table public.contracts
  add column if not exists target_account_id uuid references public.accounts (id) on delete set null;

create index if not exists spending_transactions_transfer_account_id_idx
  on public.spending_transactions (transfer_account_id);
create index if not exists contracts_target_account_id_idx
  on public.contracts (target_account_id);

-- ---------------------------------------------------------------------------
-- from 0097_goal_investments.sql: a goal can track the DEPOT rather than an
-- account balance. `linked_portfolio_id` null while `tracks_investments` is
-- true means "every portfolio combined", which is also where a goal lands if
-- its broker is deleted.
-- ---------------------------------------------------------------------------
alter table public.goals
  add column if not exists tracks_investments boolean not null default false;

alter table public.goals
  add column if not exists linked_portfolio_id uuid
    references public.portfolios (id) on delete set null;

create index if not exists goals_linked_portfolio_id_idx
  on public.goals (linked_portfolio_id);
