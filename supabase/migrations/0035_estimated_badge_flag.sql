-- Migration: feature flag for the "Estimated" badge (fabricated/synthetic
-- price & chart data indicator). Same pattern as 0030_offline_mode.sql: a row
-- in `feature_flags` the owner flips via SQL/dashboard. Seeded enabled so the
-- badge stays on by default; the owner can disable it globally or per-user.
-- Idempotent.

insert into public.feature_flags (flag, description) values
  ('estimated-badge', 'Estimated badge on synthetic/fabricated prices & charts')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0035_estimated_badge_flag')
on conflict (version) do nothing;
