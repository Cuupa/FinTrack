-- Per-transaction tax (Abgeltungsteuer on sells, transaction tax on some
-- buys), mirroring `fee`: a buy tax raises the cost basis, a sell tax reduces
-- the proceeds. Existing rows backfill to 0 via the column default.
alter table public.transactions
  add column if not exists tax numeric not null default 0 check (tax >= 0);

-- The annual tax report on /analysis is gated by a feature flag (seeded
-- enabled, same pattern as 0035).
insert into public.feature_flags (flag, description) values
  ('taxReport', 'Analysis — annual tax report (realized gains, fees, taxes per year)')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0036_transaction_tax')
on conflict (version) do nothing;
