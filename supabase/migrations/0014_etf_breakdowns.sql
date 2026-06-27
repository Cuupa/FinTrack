-- Migration: cache ETF sector/region weightings so Analysis reads from the DB
-- instead of hitting Yahoo/onvista on every view. Refreshed by
-- /api/cron/sync-etf-breakdowns. Idempotent.

create table if not exists public.etf_breakdowns (
  etf_key text not null,
  kind text not null check (kind in ('sector', 'region')),
  data jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (etf_key, kind)
);
alter table public.etf_breakdowns enable row level security;
drop policy if exists "etf breakdowns readable" on public.etf_breakdowns;
create policy "etf breakdowns readable" on public.etf_breakdowns for select using (true);

insert into public.schema_migrations (version) values ('0014_etf_breakdowns')
on conflict (version) do nothing;
