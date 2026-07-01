-- Migration: allow the BOOKING transaction type (German "Einbuchung") — a
-- cost-free crediting of shares (e.g. an employer's vermögenswirksame Leistung
-- or a gift), booked at zero cost basis so its full value is profit. Idempotent.

alter table public.transactions
  drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (type in ('BUY', 'SELL', 'BOOKING'));

insert into public.schema_migrations (version) values ('0023_transaction_booking')
on conflict (version) do nothing;
