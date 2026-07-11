-- Self-hosted error-log pipeline (admin backend stage 3): the client error
-- boundaries and a window-level error/unhandledrejection listener report
-- here via POST /api/errors (flag-gated, rate-limited, no user id / IP
-- stored). Admins browse via /admin/errors under RLS (public.is_admin(),
-- migration 0050); a 30-day retention cron
-- (app/api/cron/sync/error-logs) purges old rows.
create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'boundary',
  message text,
  stack text,
  route text,
  digest text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.error_logs enable row level security;
drop policy if exists "error logs admin readable" on public.error_logs;
create policy "error logs admin readable" on public.error_logs for select using (public.is_admin());
create index if not exists error_logs_created_at_idx on public.error_logs (created_at desc);

insert into public.feature_flags (flag, enabled, description) values
  ('errorLogging', true, 'Server-side capture of client error reports')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0051_error_logs')
on conflict (version) do nothing;
