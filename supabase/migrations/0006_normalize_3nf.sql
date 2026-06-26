-- Migration: normalize to 3NF. Idempotent.
--
-- Violations removed:
--   * `assets` duplicated instrument master data (name, isin, wkn, symbol,
--     type, currency) that is functionally determined by the instrument, not
--     the asset. Assets now reference `instrument_id`.
--   * `transactions.user_id` was transitively dependent (id -> asset_id ->
--     user_id). Removed; ownership is derived via the asset.
--
-- Custom (non-catalog) assets get a user-owned instrument row (`owner` set).

-- 1. instruments.owner (null = global catalog) --------------------------------
alter table public.instruments
  add column if not exists owner uuid references auth.users (id) on delete cascade;

-- Symbol uniqueness applies to the global catalog only, so user-owned
-- instruments may reuse symbols.
drop index if exists public.instruments_symbol_key;
create unique index if not exists instruments_symbol_key
  on public.instruments (symbol) where symbol is not null and owner is null;

drop policy if exists "instruments readable" on public.instruments;
create policy "instruments readable" on public.instruments
  for select using (owner is null or owner = auth.uid());
drop policy if exists "own instruments write" on public.instruments;
create policy "own instruments write" on public.instruments
  for all using (owner = auth.uid()) with check (owner = auth.uid());

-- 2. assets -> instrument_id --------------------------------------------------
alter table public.assets
  add column if not exists instrument_id uuid references public.instruments (id);

-- Backfill: link each asset to a matching global instrument, creating a
-- user-owned one when no catalog match exists. Guarded so re-runs are no-ops.
do $$
declare
  a record;
  iid uuid;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assets' and column_name = 'name'
  ) then
    for a in
      select id, user_id, isin, wkn, symbol, name, type, currency
      from public.assets where instrument_id is null
    loop
      select id into iid from public.instruments
        where owner is null and (
          (a.isin is not null and isin = a.isin) or
          (a.wkn is not null and wkn = a.wkn) or
          (a.symbol is not null and symbol = a.symbol))
        limit 1;
      if iid is null then
        insert into public.instruments (owner, isin, wkn, symbol, name, type, currency)
          values (a.user_id, a.isin, a.wkn, a.symbol, a.name, a.type, a.currency)
          returning id into iid;
      end if;
      update public.assets set instrument_id = iid where id = a.id;
    end loop;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from public.assets where instrument_id is null) then
    alter table public.assets alter column instrument_id set not null;
  end if;
end $$;

-- Drop the now-redundant embedded master data.
alter table public.assets drop column if exists isin;
alter table public.assets drop column if exists wkn;
alter table public.assets drop column if exists symbol;
alter table public.assets drop column if exists name;
alter table public.assets drop column if exists type;
alter table public.assets drop column if exists currency;

-- 3. transactions: drop the transitive user_id --------------------------------
drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions for all
  using (asset_id in (select id from public.assets where user_id = auth.uid()))
  with check (asset_id in (select id from public.assets where user_id = auth.uid()));

alter table public.transactions drop column if exists user_id;
