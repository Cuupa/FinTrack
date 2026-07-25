-- Household-shared entities, round 2 (ROADMAP #13 continued): extends the
-- household_peer_ids() pattern proven on accounts (migration 0092) to the
-- rest of the financial-data tables, so a household actually shares a whole
-- portfolio picture, not just balance accounts.
--
-- Extended: portfolios, assets, transactions (owned via assets, no user_id
-- column of its own), watchlist_items, savings_plans, tag_groups,
-- asset_tags, asset_valuations, spending_categories, spending_transactions,
-- budgets, contracts, goals, imported_rows, imported_spending_rows (the
-- last two follow transactions/spending_transactions so re-import dedupe
-- keeps working correctly once those are shared -- otherwise a peer
-- re-importing a statement a fellow member already imported into a shared
-- portfolio would not see the fingerprint and would create duplicates).
--
-- Deliberately NOT extended (stay strictly personal regardless of
-- household membership):
--   - llm_settings: can hold a live BYO LLM API key (account-scoped storage
--     option, see LLM_INTEGRATION.md). Auto-sharing that would let a
--     household peer spend against a member's own API billing without an
--     explicit, separate decision -- out of scope for this round.
--   - simulation_runs: a pure Monte Carlo result cache keyed by input hash,
--     not user financial data; nothing is gained by sharing it and nothing
--     breaks by leaving it personal.
--   - profiles: per-user preferences (currency, locale, tax settings like
--     the Sparerpauschbetrag/Kirchensteuer, which are individual to each
--     person's own tax situation even inside a shared household).
--   - Everything account-security/billing-shaped (push_subscriptions,
--     billing_customers, subscriptions, plan_grants, user_feature_flags,
--     admins) was never a candidate; unrelated to financial data sharing.
drop policy if exists "own portfolios" on public.portfolios;
create policy "own portfolios" on public.portfolios
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own assets" on public.assets;
create policy "own assets" on public.assets
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

-- Transactions have no user_id column of their own -- ownership derives from
-- the asset, so this subquery must extend the same way the assets policy
-- above did.
drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions for all
  using (
    asset_id in (
      select id from public.assets
      where user_id = auth.uid() or user_id in (select public.household_peer_ids())
    )
  )
  with check (
    asset_id in (
      select id from public.assets
      where user_id = auth.uid() or user_id in (select public.household_peer_ids())
    )
  );

drop policy if exists "own watchlist" on public.watchlist_items;
create policy "own watchlist" on public.watchlist_items
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own savings plans" on public.savings_plans;
create policy "own savings plans" on public.savings_plans
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own tag groups" on public.tag_groups;
create policy "own tag groups" on public.tag_groups
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own asset tags" on public.asset_tags;
create policy "own asset tags" on public.asset_tags
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own asset valuations" on public.asset_valuations;
create policy "own asset valuations" on public.asset_valuations
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own spending categories" on public.spending_categories;
create policy "own spending categories" on public.spending_categories
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own spending transactions" on public.spending_transactions;
create policy "own spending transactions" on public.spending_transactions
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own budgets" on public.budgets;
create policy "own budgets" on public.budgets
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own contracts" on public.contracts;
create policy "own contracts" on public.contracts
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own imported rows" on public.imported_rows;
create policy "own imported rows" on public.imported_rows
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own imported spending rows" on public.imported_spending_rows;
create policy "own imported spending rows" on public.imported_spending_rows
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

insert into public.schema_migrations (version) values ('0093_household_shared_entities')
on conflict (version) do nothing;
