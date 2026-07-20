-- Feature flag for the Portfolio Performance (portfolio-performance/portfolio)
-- CSV transaction import format (lib/import/csv.ts parsePortfolioPerformance).
-- Kill switch only, same pattern as 0046/0039: seeded enabled, no new tables
-- — the parser runs entirely in the browser like every other broker format.
insert into public.feature_flags (flag, description) values
  ('importPp', 'CSV import — Portfolio Performance format')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0071_import_pp_flag')
on conflict (version) do nothing;
