-- Migration: allow the SPLIT transaction type — a stock split / corporate
-- action. `quantity` holds the ratio (new shares per old share, e.g. 2 for a
-- 2-for-1 forward split, 0.5 for a 1-for-2 reverse split); price/fee/tax are
-- always 0. Idempotent.

alter table public.transactions
  drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (type in ('BUY', 'SELL', 'BOOKING', 'INTEREST', 'SPLIT'));

insert into public.schema_migrations (version) values ('0072_split_transaction_type')
on conflict (version) do nothing;
