-- Feature flag for the announced dividend calendar (COMPETITION.md F4):
-- confirmed upcoming ex/pay dates from Yahoo quoteSummary calendarEvents,
-- folded into the /dividends forecast. Kill switch only (the crumb-
-- authenticated fetch fails soft to the trailing projection), seeded enabled,
-- same pattern as 0071/0073/0074.
insert into public.feature_flags (flag, description) values
  ('dividendCalendar', 'Announced dividend calendar (confirmed upcoming ex/pay dates)')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0075_dividend_calendar_flag')
on conflict (version) do nothing;
