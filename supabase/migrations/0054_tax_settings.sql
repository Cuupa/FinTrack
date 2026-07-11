-- Adds the German tax report settings to the profile: the Sparerpauschbetrag
-- (allowance), Kirchensteuer rate and whether Teilfreistellung applies to
-- equity fund gains/dividends. Feeds the "Steuern" tab on /analysis
-- (lib/finance/tax.ts).
alter table public.profiles add column if not exists tax_allowance numeric not null default 1000;
alter table public.profiles add column if not exists church_tax_rate numeric not null default 0;
alter table public.profiles add column if not exists tax_teilfreistellung boolean not null default false;

insert into public.schema_migrations (version) values ('0054_tax_settings')
on conflict (version) do nothing;
