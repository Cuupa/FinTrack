-- Adds the guided tour's completion marker to the profile, so it follows the
-- account across devices (mirrors theme's persistence, see
-- 0056_profile_theme). Null means "tour never completed or skipped"; the
-- value is written by components/onboarding/guided-tour.tsx.
alter table public.profiles add column if not exists tour_done_at timestamptz;

insert into public.schema_migrations (version) values ('0057_profile_tour')
on conflict (version) do nothing;
