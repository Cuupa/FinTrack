-- A policy's premium leaves an account like a savings plan's rate does, so it
-- can name a Verrechnungskonto and a start date. Nothing posts silently: the
-- app collects due premiums and only books them after a review, which is what
-- `last_booked_date` then advances.
alter table public.pension_contracts
  add column if not exists account_id uuid references public.accounts (id) on delete set null;
alter table public.pension_contracts
  add column if not exists booking_start_date date;
alter table public.pension_contracts
  add column if not exists last_booked_date date;

-- The booking's origin, and what keeps it out of every expense figure: a
-- premium buys an entitlement worth what left the account, so it is a transfer,
-- not consumption. The receiving side is a policy rather than an account, which
-- is why `transfer_account_id` cannot carry this (same case as
-- `savings_plan_id`).
alter table public.spending_transactions
  add column if not exists pension_contract_id uuid
    references public.pension_contracts (id) on delete set null;
create index if not exists spending_transactions_pension_contract_id_idx
  on public.spending_transactions (pension_contract_id);
