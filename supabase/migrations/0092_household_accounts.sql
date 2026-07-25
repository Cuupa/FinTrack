-- Household-shared accounts (ROADMAP #13 round 2): a household peer can now
-- see and edit every member's accounts + balances, not just their own. This
-- is the first entity extended with public.household_peer_ids() (migration
-- 0091's helper) -- the same pattern applies mechanically to the remaining
-- user-scoped tables (portfolios, transactions, spending, contracts, goals,
-- ...) in later rounds; each is its own small, independently reviewable
-- migration, not a redesign. household_peer_ids() returns an empty set for
-- anyone not in a household, so this is a no-op until the owner flips the
-- `household` flag AND the user actually joins one -- existing single-user
-- behavior is unchanged by default.
drop policy if exists "own accounts" on public.accounts;
create policy "own accounts" on public.accounts
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own account balances" on public.account_balances;
create policy "own account balances" on public.account_balances
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

insert into public.schema_migrations (version) values ('0092_household_accounts')
on conflict (version) do nothing;
