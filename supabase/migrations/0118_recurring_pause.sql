-- Pausing what recurs (owner request): a contract or a planned cashflow can be
-- suspended exactly like a savings plan, instead of having to be deleted and
-- re-entered. `true` is the only sane default -- every existing row is running.
alter table public.contracts
  add column if not exists active boolean not null default true;

alter table public.planned_cashflows
  add column if not exists active boolean not null default true;
