-- Sondertilgungen go back to being a pure what-if (owner rule, round 27).
--
-- 0105 gave planned one-off repayments a table, so typing one into the payoff
-- planner wrote a row. That made a simulation look like a commitment: the
-- lever right above it (the extra monthly payment) has always been live-only,
-- and the two answer the same question -- "what happens if I put money in on
-- top?". They now live in React state on /debt and die with the page, so the
-- table has nothing left to hold.
--
-- 0105 stays where it is (a migration that has already run is never deleted);
-- this drops what it created.

-- The usage function counts one row per feature table, so it has to stop
-- counting this one BEFORE the table goes -- otherwise /admin/usage answers
-- 500 with "relation account_extra_repayments does not exist".
create or replace function public.admin_feature_usage()
returns table (feature text, users bigint, records bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select 'assets'::text, count(distinct a.user_id), count(*)::bigint from public.assets a
    union all select 'transactions', count(distinct a2.user_id), count(*)::bigint
      from public.transactions t join public.assets a2 on a2.id = t.asset_id
    union all select 'watchlist', count(distinct w.user_id), count(*)::bigint from public.watchlist_items w
    union all select 'savingsPlans', count(distinct s.user_id), count(*)::bigint from public.savings_plans s
    union all select 'tags', count(distinct g.user_id), count(*)::bigint from public.tag_groups g
    union all select 'accounts', count(distinct ac.user_id), count(*)::bigint from public.accounts ac
    union all select 'accountBalances', count(distinct ab.user_id), count(*)::bigint from public.account_balances ab
    union all select 'spending', count(distinct st.user_id), count(*)::bigint from public.spending_transactions st
    union all select 'spendingCategories', count(distinct sc.user_id), count(*)::bigint from public.spending_categories sc
    union all select 'recurring', count(distinct c.user_id), count(*)::bigint from public.contracts c
    union all select 'plannedCashflow', count(distinct pc.user_id), count(*)::bigint from public.planned_cashflows pc
    union all select 'goals', count(distinct go.user_id), count(*)::bigint from public.goals go
    union all select 'pensionPoints', count(distinct pp.user_id), count(*)::bigint from public.pension_points pp
    union all select 'pensionContracts', count(distinct pk.user_id), count(*)::bigint from public.pension_contracts pk
    union all select 'llm', count(distinct l.user_id), count(*)::bigint from public.llm_settings l
    union all select 'push', count(distinct ps.user_id), count(*)::bigint from public.push_subscriptions ps
    union all select 'imports', count(distinct ir.user_id), count(*)::bigint from public.imported_rows ir
    union all select 'sharing', count(distinct sp.owner), count(*)::bigint from public.shared_portfolios sp
    union all select 'proGrants', count(distinct pg.user_id), count(*)::bigint from public.plan_grants pg;
end;
$$;

grant execute on function public.admin_feature_usage() to authenticated;

drop policy if exists "own extra repayments" on public.account_extra_repayments;
drop table if exists public.account_extra_repayments;

insert into public.schema_migrations (version) values ('0110_drop_extra_repayments')
on conflict (version) do nothing;
