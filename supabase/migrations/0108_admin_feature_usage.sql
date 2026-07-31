-- Feature usage for the admin area: how many users actually USE each feature,
-- and how much they have in it.
--
-- Deliberately NOT an event tracker. Nothing new is collected, no action is
-- logged, no cookie is set: the figures are aggregates over rows the user
-- already stored, computed on demand. That keeps the privacy policy's promise
-- ("no analytics or tracking services") true while still answering "is anyone
-- using the pension planner".
--
-- SECURITY DEFINER because the per-user tables are RLS-scoped to their owner;
-- the function itself is admin-only (public.is_admin(), the same predicate the
-- admin RLS policies use) and returns COUNTS ONLY, never a row's contents.

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
    union all select 'transactions', count(distinct t.user_id), count(*)::bigint from public.transactions t
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
