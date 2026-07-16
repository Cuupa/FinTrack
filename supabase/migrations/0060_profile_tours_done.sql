-- Per-page guided tours (round 21): risk, rebalancing, simulation, asset
-- tags each track their own completion, separate from the original
-- dashboard tour's `tour_done_at` (see 0057_profile_tour). Keyed by tourId
-- -> ISO datetime completed/skipped, written by
-- components/onboarding/page-tours.tsx.
alter table public.profiles add column if not exists tours_done jsonb not null default '{}'::jsonb;

insert into public.schema_migrations (version) values ('0060_profile_tours_done')
on conflict (version) do nothing;
