-- Migration: live shares. A share can be a frozen "snapshot" or a "live" share
-- that its owner keeps refreshed as their portfolio changes. Adds an owner (for
-- live shares) and a mode, plus an owner-scoped update policy so the owner can
-- keep their live shares current from the browser. Idempotent.

alter table public.shared_portfolios add column if not exists owner uuid;
alter table public.shared_portfolios add column if not exists mode text not null default 'snapshot';

drop policy if exists "shared portfolios owner update" on public.shared_portfolios;
create policy "shared portfolios owner update" on public.shared_portfolios
  for update using (owner = auth.uid()) with check (owner = auth.uid());

insert into public.schema_migrations (version) values ('0019_shared_live')
on conflict (version) do nothing;
