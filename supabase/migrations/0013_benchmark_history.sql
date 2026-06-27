-- Migration: cache benchmark price history so the chart comparison feature
-- reads from the DB instead of hitting Yahoo on every view. Idempotent.

create table if not exists public.benchmark_history (
  benchmark_id text not null,
  date date not null,
  close numeric not null,
  primary key (benchmark_id, date)
);
alter table public.benchmark_history enable row level security;
drop policy if exists "benchmark history readable" on public.benchmark_history;
create policy "benchmark history readable" on public.benchmark_history for select using (true);

insert into public.schema_migrations (version) values ('0013_benchmark_history')
on conflict (version) do nothing;
