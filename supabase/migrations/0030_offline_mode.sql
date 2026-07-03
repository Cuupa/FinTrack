-- Migration: feature flag for offline mode (phase 1 — read-only offline app
-- shell + cached catalog + staleness banner, see OFFLINE_DESIGN.md). Same
-- pattern as 0027_feature_flags.sql: a row in `feature_flags` the owner
-- flips via SQL/dashboard. Idempotent.

insert into public.feature_flags (flag, description) values
  ('offline', 'Offline mode (read-only app shell + last-known data)')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0030_offline_mode')
on conflict (version) do nothing;
