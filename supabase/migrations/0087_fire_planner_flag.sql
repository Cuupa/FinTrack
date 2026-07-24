-- Retirement / FIRE planner (ROADMAP item #8, flag `firePlanner`): a purely
-- derived read-only surface reframing the existing Monte Carlo engine
-- (lib/finance/monte-carlo.ts) and the measured return/volatility estimator
-- (lib/finance/stats.ts) as a goal -- FIRE number (lean/regular/fat),
-- years-to-FI, withdrawal-rate framing. No new table -- this migration only
-- seeds the feature flag row.

-- Seeded DISABLED (dark-launched): the /fire planner only appears once the
-- owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('firePlanner', false, 'Retirement / FIRE planner: lean/regular/fat FIRE numbers, years-to-FI, and a withdrawal-rate Monte Carlo run')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0087_fire_planner_flag')
on conflict (version) do nothing;
