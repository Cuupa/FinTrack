-- Migration: dedupe + format-validate the instruments catalog. isin/wkn were
-- only indexed (non-unique) before, so two racing inserts for the same
-- security could create duplicate rows; the unique partial indexes close that
-- race the same way instruments_symbol_key already does for symbol. The
-- format checks catch garbage identifiers at write time. The open insert
-- policy (`with check (true)`) is replaced with one requiring at least one
-- identifier, since a totally empty instrument row is never legitimate.
-- Idempotent.

create unique index if not exists instruments_isin_key on public.instruments (isin) where isin is not null;
create unique index if not exists instruments_wkn_key  on public.instruments (wkn)  where wkn is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'instruments_isin_format') then
    alter table public.instruments add constraint instruments_isin_format
      check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instruments_wkn_format') then
    alter table public.instruments add constraint instruments_wkn_format
      check (wkn is null or wkn ~ '^[A-Z0-9]{6}$') not valid;
  end if;
end $$;

drop policy if exists "instruments insertable" on public.instruments;
create policy "instruments insertable" on public.instruments
  for insert to authenticated
  with check (isin is not null or wkn is not null or symbol is not null);

insert into public.schema_migrations (version) values ('0032_instruments_dedupe')
on conflict (version) do nothing;
