-- Contracts post bookings into spending (ROADMAP #5 cont.).
--
-- A contract was a register entry only: it recorded that you pay 12.99 a month
-- but never produced the transaction. These three columns let it materialise
-- its charges the same way a savings plan materialises BUY transactions --
-- derived from (booking_start_date, interval, last_booked_date), never stored
-- per occurrence.
--
-- All three are nullable and default null, so every existing contract keeps
-- behaving exactly as before: booking is off until an account is chosen.
--
-- account_id is `on delete set null` rather than cascade, matching
-- category_id's precedent on this same table: a contract whose account was
-- deleted still means something (it just stops booking), unlike a budget
-- without its category.

alter table public.contracts
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

alter table public.contracts
  add column if not exists booking_start_date date;

alter table public.contracts
  add column if not exists last_booked_date date;

create index if not exists contracts_account_id_idx on public.contracts (account_id);
