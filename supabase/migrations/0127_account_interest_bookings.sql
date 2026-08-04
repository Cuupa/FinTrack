alter table public.spending_transactions
  add column if not exists interest_account_id uuid references public.accounts (id) on delete set null;

create index if not exists spending_transactions_interest_account_id_idx
  on public.spending_transactions (interest_account_id);
