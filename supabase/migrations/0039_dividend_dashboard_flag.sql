-- Feature flag for the /dividends dashboard (seeded enabled, same pattern as
-- 0035). The page itself needs no new tables — it aggregates the real payout
-- events already served by /api/dividends.
insert into public.feature_flags (flag, description) values
  ('dividends', 'Dividend dashboard (/dividends)')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0039_dividend_dashboard_flag')
on conflict (version) do nothing;
