-- Migration: cache Monte Carlo simulation runs so rerunning with identical
-- parameters reuses the stored result instead of recomputing. Keyed by a hash
-- of the (seed-independent) params; the seed is stored for auditing. Idempotent.

create table if not exists public.simulation_runs (
  user_id uuid not null references auth.users (id) on delete cascade,
  params_hash text not null,
  params jsonb not null,
  seed bigint not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, params_hash)
);

alter table public.simulation_runs enable row level security;
drop policy if exists "own simulations" on public.simulation_runs;
create policy "own simulations" on public.simulation_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.schema_migrations (version) values ('0024_simulation_runs')
on conflict (version) do nothing;
