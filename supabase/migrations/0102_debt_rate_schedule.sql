-- Fixed-rate period for liability accounts (ROADMAP #9, flag `debtPayoff`).
--
-- The problem this fixes: a liability carried exactly ONE `interest_rate`, so
-- a mortgage whose Zinsbindung runs out in 2036 could only be modelled by
-- overwriting the rate that applies today with a guess about 2036. Both
-- figures are real and both are needed, so they get a column each.
--
-- Semantics (mirrored by `accountRateSteps` in lib/finance/debt.ts):
--   * up to and including `rate_fixed_until`, `interest_rate` applies
--   * from the day after, `follow_up_rate` applies
--   * either column null = one rate for the whole term (the old behaviour)
--
-- Additive and nullable, so an unmigrated row keeps amortising exactly as
-- before -- nothing in prod changes until a user fills the fields in.

alter table public.accounts
  add column if not exists rate_fixed_until date;
alter table public.accounts
  add column if not exists follow_up_rate numeric;
