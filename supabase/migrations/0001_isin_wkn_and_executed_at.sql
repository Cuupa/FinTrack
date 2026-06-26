-- Migration: identify assets by ISIN/WKN (drop ticker, add symbol) and store a
-- full timestamp for transactions (date -> executed_at). Idempotent: safe to
-- run repeatedly and against a fresh or already-migrated database.

-- Assets: ticker -> symbol -----------------------------------------------------
alter table public.assets add column if not exists symbol text;

do $$
begin
  -- Preserve any existing ticker values as the new symbol before dropping it.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assets' and column_name = 'ticker'
  ) then
    update public.assets set symbol = coalesce(symbol, ticker);
    alter table public.assets drop column ticker;
  end if;
end $$;

-- Transactions: date (date) -> executed_at (timestamptz) ----------------------
alter table public.transactions add column if not exists executed_at timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'date'
  ) then
    update public.transactions
      set executed_at = coalesce(executed_at, date::timestamptz);
    alter table public.transactions drop column date;
  end if;
end $$;

-- Enforce NOT NULL only once every row has a value.
do $$
begin
  if not exists (select 1 from public.transactions where executed_at is null) then
    alter table public.transactions alter column executed_at set not null;
  end if;
end $$;
