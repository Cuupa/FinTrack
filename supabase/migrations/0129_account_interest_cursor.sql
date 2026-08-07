-- Skipping a due interest posting needs a cursor of its own: the posted rows
-- (spending_transactions.interest_account_id) only record what WAS booked, so
-- an occurrence the user declined had nowhere to be remembered and came back.
alter table public.accounts
  add column if not exists interest_skipped_until date;
