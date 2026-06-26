-- Migration: store the transaction time as a floating wall-clock
-- (`timestamp without time zone`) rather than an instant (`timestamptz`).
-- A trade time is the local wall-clock the user picked; storing it as
-- timestamptz made Postgres reinterpret it as UTC and shift it on display.
-- Idempotent: only converts when the column is still timestamptz.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'executed_at'
      and data_type = 'timestamp with time zone'
  ) then
    alter table public.transactions
      alter column executed_at type timestamp without time zone
      using executed_at at time zone 'UTC';
  end if;
end $$;
