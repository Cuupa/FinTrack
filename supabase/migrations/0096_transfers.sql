-- Transfers: recurring charges that are not consumption.
--
-- A loan instalment and a wealth-building premium (Riester, kapitalbildende
-- Lebensversicherung) look exactly like a subscription -- same payee, same
-- cadence, same amount -- but they are not spent. Cash falls and either a debt
-- falls with it or a policy's value rises, so net worth is unchanged at the
-- moment of payment and only the composition shifts. Booked as plain expenses
-- they would misstate the spending picture by the full premium every month.
--
-- `transfer_account_id` marks the booking as such; `lib/finance/spending.ts`
-- skips those rows in every aggregation (income/expense split, category
-- totals, budgets, safe-to-spend). `contracts.target_account_id` is what makes
-- a contract post them.
--
-- Neither column moves an account balance. In this app an account's value is
-- its opening balance plus the dated readings the user maintains, and ordinary
-- spending does not move it either -- see the accounts section of
-- supabase/schema.sql. Deliberately unchanged here.
--
-- Both are `on delete set null`: deleting the far account must not delete the
-- booking (it happened) nor the contract, matching contracts.category_id.

alter table public.spending_transactions
  add column if not exists transfer_account_id uuid references public.accounts (id) on delete set null;

alter table public.contracts
  add column if not exists target_account_id uuid references public.accounts (id) on delete set null;

create index if not exists spending_transactions_transfer_account_id_idx
  on public.spending_transactions (transfer_account_id);
create index if not exists contracts_target_account_id_idx
  on public.contracts (target_account_id);
