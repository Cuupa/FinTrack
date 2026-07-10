-- Feature flags for the portfolio export menu (seeded enabled, same pattern
-- as 0046). No new tables — export runs entirely client-side against data
-- already in memory (lib/export/export.ts).
insert into public.feature_flags (flag, description) values
  ('exportCsv', 'Portfolio export — Download CSV'),
  ('exportJson', 'Portfolio export — Download JSON')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0047_export_flags')
on conflict (version) do nothing;
