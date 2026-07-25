-- Insurance register + coverage prompts (ROADMAP item #10, flag `insurance`):
-- typed rows on the contract entity from #5 rather than a separate table.
-- `insurance_type` (liability/health/household/legal/disability/life/vehicle/
-- other) and `sum_insured` (profile base currency) are both nullable -- null
-- `insurance_type` means an ordinary (non-insurance) contract, unaffected.
alter table public.contracts
  add column if not exists insurance_type text;
alter table public.contracts
  drop constraint if exists contracts_insurance_type_check;
alter table public.contracts
  add constraint contracts_insurance_type_check check (
    insurance_type is null or insurance_type in (
      'liability', 'health', 'household', 'legal', 'disability', 'life', 'vehicle', 'other'
    )
  );
alter table public.contracts
  add column if not exists sum_insured numeric;

-- Seeded DISABLED (dark-launched): insurance-typed fields + coverage-gap
-- prompts on /contracts only appear once the owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('insurance', false, 'Insurance register (typed contracts: type + sum insured) with coverage-gap prompts')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0089_insurance')
on conflict (version) do nothing;
