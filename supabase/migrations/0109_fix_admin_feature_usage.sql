-- Repairs 0108: public.transactions carries no user_id (it is scoped through
-- its asset), so admin_feature_usage() raised "column t.user_id does not
-- exist" and /admin/usage answered 500 for every admin. 0108 stays where it is
-- -- a migration that has already run is never rewritten -- and this replaces
-- the function body.


create or replace function public.admin_feature_usage()
returns table (feature text, users bigint, records bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Two callers, two identities: the browser (an admin's own JWT, checked with
  -- is_admin()) and the server route (the secret key, whose auth.uid() is NULL
  -- and would fail that check). Without the service_role arm the API route
  -- backing /admin/usage could never read its own function.
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select 'assets'::text, count(distinct a.user_id), count(*)::bigint from public.assets a
    -- `transactions` hangs off the user through its asset, it has no user_id
    -- of its own (that is what made 0108 fail with "column t.user_id does
    -- not exist" on every call).
    union all select 'transactions', count(distinct a2.user_id), count(*)::bigint
      from public.transactions t join public.assets a2 on a2.id = t.asset_id
    union all select 'watchlist', count(distinct w.user_id), count(*)::bigint from public.watchlist_items w
    union all select 'savingsPlans', count(distinct s.user_id), count(*)::bigint from public.savings_plans s
    union all select 'tags', count(distinct g.user_id), count(*)::bigint from public.tag_groups g
    union all select 'accounts', count(distinct ac.user_id), count(*)::bigint from public.accounts ac
    union all select 'accountBalances', count(distinct ab.user_id), count(*)::bigint from public.account_balances ab
    union all select 'extraRepayments', count(distinct er.user_id), count(*)::bigint from public.account_extra_repayments er
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
    -- A share link is owned by `owner`, not `user_id`, and an anonymous guest
    -- share has no owner at all -- those count as records without a user.
    union all select 'sharing', count(distinct sp.owner), count(*)::bigint from public.shared_portfolios sp
    union all select 'proGrants', count(distinct pg.user_id), count(*)::bigint from public.plan_grants pg;
end;
$$;

grant execute on function public.admin_feature_usage() to authenticated;
