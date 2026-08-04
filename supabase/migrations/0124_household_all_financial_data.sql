-- Household access covers every financial surface, including retirement
-- provision. Keep personal settings and credentials self-only.

drop policy if exists "own pension points" on public.pension_points;
create policy "own pension points" on public.pension_points
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own pension statements" on public.pension_statements;
create policy "own pension statements" on public.pension_statements
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own pension contracts" on public.pension_contracts;
create policy "own pension contracts" on public.pension_contracts
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

drop policy if exists "own pension contract values" on public.pension_contract_values;
create policy "own pension contract values" on public.pension_contract_values
  for all using (auth.uid() = user_id or user_id in (select public.household_peer_ids()))
  with check (auth.uid() = user_id or user_id in (select public.household_peer_ids()));

insert into public.schema_migrations (version) values ('0124_household_all_financial_data')
on conflict (version) do nothing;

insert into public.plan_limits (limit_key, free_value, pro_value)
values ('householdMembers', 2, null)
on conflict (limit_key) do update set free_value = 2, pro_value = null;
