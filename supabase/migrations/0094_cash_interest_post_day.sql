-- Let the user choose which calendar day interest posts on (TODO.md "Interest
-- Rate": "make user chose date, last day of month and first day of month").
-- Nullable text on the assets row, values 'first' | 'last'; null keeps the
-- existing behaviour (the day-of-month of the asset's first transaction,
-- clamped to shorter months -- see lib/finance/cash-interest.ts payoutDate).
alter table public.assets add column if not exists interest_post_day text;

insert into public.schema_migrations (version) values ('0094_cash_interest_post_day')
on conflict (version) do nothing;
