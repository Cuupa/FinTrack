-- "Last day of the month" as a schedule, for contracts and planned cashflows.
--
-- Rent and salaries land on the month's end, which is not the same as "the
-- 30th": the two only agree in some months. The day-of-month clamp in
-- `addMonthsToDate` cannot express it either -- it walks a start date forward
-- and shortens it only where the target month is shorter, so a plan anchored
-- on the 28th stays on the 28th forever.
--
-- Stored rather than inferred from the start date on purpose: a start on the
-- 30th is genuinely ambiguous between "the 30th" and "the last day", and
-- guessing would silently move a payment the user never asked to move.
--
-- Defaults false, so every existing row keeps the literal day it has been
-- booking on and nothing reschedules itself on deploy.

alter table public.contracts
  add column if not exists month_end boolean not null default false;

alter table public.planned_cashflows
  add column if not exists month_end boolean not null default false;
