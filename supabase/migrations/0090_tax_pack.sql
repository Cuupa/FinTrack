-- Tax pack (ROADMAP item #11, flag `taxPack`): extends the capital-gains tax
-- report (lib/finance/tax.ts) with deductible-expense tagging on the existing
-- spending-category taxonomy (ROADMAP #2) and a year-end advisor/Elster
-- export. `tax_deductible` is nullable -- existing categories predate this
-- field and default to "not deductible" (null), unaffected.
alter table public.spending_categories
  add column if not exists tax_deductible boolean;

-- Seeded DISABLED (dark-launched): the deductible-expense toggle and the tax
-- pack export only appear once the owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('taxPack', false, 'Tax pack: deductible-expense tagging on spending categories + a year-end advisor/Elster export')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0090_tax_pack')
on conflict (version) do nothing;
