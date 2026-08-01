-- Repairs the transfer target that "Add as recurring" used to drop.
--
-- `makeRecurring` (components/spending/spending-view.tsx) built the new
-- contract / planned cashflow with `targetAccountId: null` hardcoded, even
-- when the booking it was promoted FROM carried a transfer target. So a loan
-- instalment promoted to recurring silently became an ordinary consumed
-- expense: every occurrence it booked from then on counted as spending and
-- moved nothing onto the loan, which is the whole reason for tracking one.
--
-- DATA REPAIR ONLY -- no structure changes, so supabase/schema.sql is
-- deliberately untouched: a fresh database has none of these rows.
--
-- Idempotent: a second run finds every target already set and matches nothing.
--
-- To SEE what it would touch before running it, this reads nothing but the
-- affected rows:
--
--   select c.name, c.target_account_id, a.name as would_become,
--          count(tx.id) filter (where tx.transfer_account_id is null) as bookings
--   from public.contracts c
--   join public.spending_transactions tx on tx.recurring_id = c.id
--   join public.accounts a on a.id = tx.transfer_account_id
--   where c.target_account_id is null
--   group by c.name, c.target_account_id, a.name;

do $$
declare
  repaired uuid[] := '{}';
  fixed_contracts integer := 0;
  fixed_planned integer := 0;
  fixed_bookings integer := 0;
begin
  -- Guard the whole repair on the columns existing, so a database that has
  -- not yet run 0095/0096 skips it instead of erroring.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contracts'
      and column_name = 'target_account_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spending_transactions'
      and column_name = 'transfer_account_id'
  ) then
    raise notice '0112: transfer columns absent, nothing to repair';
    return;
  end if;

  -- 1. The seeding booking is the evidence: it is the one row linked to the
  --    entry that still carries a transfer target of its own (the occurrences
  --    the entry generated afterwards were written without one). Only entries
  --    whose bookings agree on a SINGLE target are touched -- anything
  --    ambiguous is left alone rather than guessed at.
  with seed as (
    select recurring_id as id, min(transfer_account_id::text)::uuid as target
    from public.spending_transactions
    where recurring_id is not null and transfer_account_id is not null
    group by recurring_id
    having count(distinct transfer_account_id) = 1
  ), upd as (
    update public.contracts c
    set target_account_id = seed.target
    from seed
    where c.id = seed.id and c.target_account_id is null
    returning c.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into repaired from upd;
  fixed_contracts := array_length(repaired, 1);

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spending_transactions'
      and column_name = 'planned_id'
  ) then
    with seed as (
      select planned_id as id, min(transfer_account_id::text)::uuid as target
      from public.spending_transactions
      where planned_id is not null and transfer_account_id is not null
      group by planned_id
      having count(distinct transfer_account_id) = 1
    )
    update public.planned_cashflows p
    set transfer_account_id = seed.target
    from seed
    where p.id = seed.id and p.transfer_account_id is null;
    get diagnostics fixed_planned = row_count;
  end if;

  -- 2. The occurrences those entries already posted are still filed as
  --    ordinary spending. Leaving them would contradict the entry just
  --    repaired -- it would say "moves to the loan" while its own history says
  --    "spent". Marking them makes lib/finance/spending.ts stop counting them
  --    as expense (they are neither income nor expense), so past spending
  --    totals fall by the amount that was never really consumed.
  --
  --    Scoped to the contracts repaired above, deliberately: a contract that
  --    already had its target is not evidence of this bug, and a booking under
  --    it without a transfer may well have been edited that way on purpose.
  if array_length(repaired, 1) > 0 then
    update public.spending_transactions tx
    set transfer_account_id = c.target_account_id
    from public.contracts c
    where tx.recurring_id = c.id
      and tx.recurring_id = any(repaired)
      and tx.transfer_account_id is null
      and c.target_account_id is not null;
    get diagnostics fixed_bookings = row_count;
  end if;

  raise notice '0112: repaired % contracts, % planned cashflows, % bookings',
    coalesce(fixed_contracts, 0), coalesce(fixed_planned, 0), fixed_bookings;
end $$;
