-- Confirming a due savings-plan occurrence writes up to three things: the
-- depot BUY, the debit on the Verrechnungskonto, and the plan's `last_run_date`.
-- Nothing tied them together, so a run that failed part way left the rows
-- written and the cursor behind, the same occurrences surfaced again, and
-- confirming a second time bought the same units twice.
--
-- The debit could already be recognised by `savings_plan_id`. The BUY could
-- not: `transactions` had no link to the plan at all. This is that link, and
-- it is an identity only -- the finance core keeps reading these as ordinary
-- BUY transactions.
alter table public.transactions
  add column if not exists savings_plan_id uuid
    references public.savings_plans (id) on delete set null;
create index if not exists transactions_savings_plan_id_idx
  on public.transactions (savings_plan_id);

-- Deliberately not a unique index on (savings_plan_id, executed_at::date): a
-- database that already collected duplicates from the bug above could not run
-- this migration at all, and repairing that by deleting somebody's
-- transactions is not a migration's call. Recognition happens in the store,
-- which reports what it found instead of destroying it.
