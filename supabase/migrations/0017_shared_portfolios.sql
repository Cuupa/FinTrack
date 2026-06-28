-- Migration: shared portfolio snapshots. A short id maps to the already
-- mode-appropriate JSON payload, so share links stay short instead of encoding
-- the whole snapshot in the URL. World-readable by id (that's the share link);
-- written by the service role. Idempotent.

create table if not exists public.shared_portfolios (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.shared_portfolios enable row level security;
drop policy if exists "shared portfolios readable" on public.shared_portfolios;
create policy "shared portfolios readable" on public.shared_portfolios for select using (true);

insert into public.schema_migrations (version) values ('0017_shared_portfolios')
on conflict (version) do nothing;
