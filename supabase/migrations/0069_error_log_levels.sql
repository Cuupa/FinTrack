-- Reworks the error log around severity LEVELS instead of only the capture
-- source. `error_logs.kind` (boundary/window/unhandledrejection) stays as a
-- secondary "how was this captured" column, but `level`
-- (debug|info|warn|error|fatal) becomes the primary classification and the
-- /admin/errors filter. Every row captured so far came from a genuine
-- crash (a boundary, a window error, or an unhandled rejection) so the
-- 'error' default backfills existing rows correctly.
alter table public.error_logs add column if not exists level text not null default 'error';

alter table public.error_logs drop constraint if exists error_logs_level_check;
alter table public.error_logs add constraint error_logs_level_check
  check (level in ('debug', 'info', 'warn', 'error', 'fatal'));

create index if not exists error_logs_level_idx on public.error_logs (level);

insert into public.schema_migrations (version) values ('0069_error_log_levels')
on conflict (version) do nothing;
