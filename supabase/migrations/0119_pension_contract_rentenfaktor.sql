-- A private Rentenversicherung states a RENTENFAKTOR, not a monthly pension:
-- so much monthly pension per 10.000 of capital at the start of the payout. The
-- payout therefore follows from the capital (today's value plus the premiums
-- still to come, raised every year by the Beitragsdynamik, grown at the assumed
-- return), and asking the user for the monthly figure asked them to do that
-- arithmetic themselves and redo it after every change.
--
-- `expected_monthly_pension` stays: a policy whose factor the user does not
-- have still belongs in the projection, and every row entered before this
-- migration keeps working unchanged.

alter table public.pension_contracts
  add column if not exists rentenfaktor numeric;

alter table public.pension_contracts
  add column if not exists contribution_dynamic_pct numeric;

alter table public.pension_contracts
  add column if not exists expected_return_pct numeric;
