-- Persisted rebalancing targets (COMPETITION.md F10, closes G11): the
-- /rebalancing target grid was client-only and forgotten on reload. Store the
-- whole plan ({mode, weights by row id, freely-added custom positions}) as a
-- jsonb blob on the profile, rehydrated on load through the existing
-- updateProfile store-seam mutation (same pattern as tours_done /
-- tax_vorabpauschale). No new table, no new mutation.
alter table public.profiles
  add column if not exists rebalance_targets jsonb not null
  default '{"mode":"trade","weights":{},"custom":[]}'::jsonb;

insert into public.schema_migrations (version) values ('0078_rebalance_targets')
on conflict (version) do nothing;
