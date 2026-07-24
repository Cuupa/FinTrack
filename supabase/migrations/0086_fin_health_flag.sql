-- Financial-health gauges (ROADMAP item #7, flag `finHealth`): a purely
-- derived read-only surface (months-of-expenses covered, savings rate,
-- debt-to-income, net-worth-to-income) computed from accounts (#1), spending
-- (#2) and budgets (#4) already in the tree. No new table -- this migration
-- only seeds the feature flag row.

-- Seeded DISABLED (dark-launched): the /health gauges only appear once the
-- owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('finHealth', false, 'Financial-health gauges: months-of-expenses covered, savings rate, debt-to-income, net-worth-to-income')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0086_fin_health_flag')
on conflict (version) do nothing;
