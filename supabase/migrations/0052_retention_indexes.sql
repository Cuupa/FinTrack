-- Indexes supporting the retention prune scans in
-- app/api/cron/sync/retention/route.ts, which deletes rows older than a
-- cutoff on these columns for simulation_runs and instrument_history.
-- Without these, both deletes fall back to sequential scans as the tables
-- grow.

create index if not exists simulation_runs_created_at_idx
  on public.simulation_runs (created_at);

create index if not exists instrument_history_synced_at_idx
  on public.instrument_history (synced_at);

insert into public.schema_migrations (version) values ('0052_retention_indexes')
on conflict (version) do nothing;
