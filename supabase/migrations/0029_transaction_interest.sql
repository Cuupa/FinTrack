-- Migration: allow the INTEREST transaction type — interest credited to a
-- cash position, booked at zero cost basis (like BOOKING) so its full value
-- counts as return. Idempotent.

alter table public.transactions
  drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (type in ('BUY', 'SELL', 'BOOKING', 'INTEREST'));

insert into public.schema_migrations (version) values ('0029_transaction_interest')
on conflict (version) do nothing;
