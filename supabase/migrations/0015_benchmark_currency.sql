-- Migration: track the currency of cached benchmark history. The cache stores
-- the native series plus a copy pre-converted (via historic FX) into each
-- common base currency, so benchmark returns are comparable to a user's
-- home-currency holdings regardless of their base. Reads filter by currency.
-- Idempotent.

alter table public.benchmark_history add column if not exists currency text;

-- Backfill any pre-existing rows (stored in EUR) and lock the column down so it
-- can participate in the primary key.
update public.benchmark_history set currency = 'EUR' where currency is null;
alter table public.benchmark_history alter column currency set default 'EUR';
alter table public.benchmark_history alter column currency set not null;

-- A benchmark now has one row per (date, currency); the old (benchmark_id, date)
-- primary key would reject the per-currency copies. Rebuild it to include
-- currency. Drop by whatever name the constraint currently has.
do $$
declare pk text;
begin
  select conname into pk
  from pg_constraint
  where conrelid = 'public.benchmark_history'::regclass and contype = 'p';
  if pk is not null then
    execute format('alter table public.benchmark_history drop constraint %I', pk);
  end if;
end $$;
alter table public.benchmark_history
  add constraint benchmark_history_pkey primary key (benchmark_id, date, currency);

-- Index the read path (filter by benchmark + currency, newest first).
create index if not exists benchmark_history_id_currency_date_idx
  on public.benchmark_history (benchmark_id, currency, date desc);

insert into public.schema_migrations (version) values ('0015_benchmark_currency')
on conflict (version) do nothing;
