-- A booking has a calendar date for ledger calculations and an optional
-- wall-clock timestamp for statement-level accuracy. Existing rows remain
-- valid and continue to display their date only.
alter table public.spending_transactions
  add column if not exists booked_at timestamp;

create index if not exists spending_transactions_booked_at_idx
  on public.spending_transactions (booked_at);
