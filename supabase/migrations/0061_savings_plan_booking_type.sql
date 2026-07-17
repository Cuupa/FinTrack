-- Savings plans can book due executions as a free external inflow
-- (Einbuchung, e.g. employer-paid vermögenswirksame Leistungen) instead of a
-- BUY from the user's own money. BUY stays the default; the finance core
-- already credits BOOKING transactions at zero cost basis.
alter table public.savings_plans add column if not exists booking_type text not null default 'BUY';

insert into public.schema_migrations (version) values ('0061_savings_plan_booking_type')
on conflict (version) do nothing;
