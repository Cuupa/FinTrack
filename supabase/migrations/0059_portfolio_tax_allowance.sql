-- Per-portfolio (broker) Freistellungsauftrag: the user distributes their
-- Sparerpauschbetrag across brokers, registering an amount at each. Null =
-- none registered at that broker; the global profiles.tax_allowance stays
-- the fallback used until at least one portfolio has this set
-- (lib/finance/tax.ts).
alter table public.portfolios add column if not exists tax_allowance numeric;

insert into public.schema_migrations (version) values ('0059_portfolio_tax_allowance')
on conflict (version) do nothing;
