-- The seat trigger from 0125 never fired. `select ... into max_members` sets
-- the variable to NULL when no row matches, and a household without a paid
-- seat add-on has no row -- so the comparison was `count(*) >= null`, which is
-- NULL, and the limit was enforced for nobody. Read the add-on into its own
-- variable and derive the cap from it.
--
-- The base of two people is `plan_limits.householdMembers`, so the number
-- lives in one place; extra seats come from the Stripe add-on. Pro therefore
-- carries the same base as Free (an extra member is bought, not unlocked),
-- which is what the household view already shows.
create or replace function public.enforce_household_member_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base_members integer;
  extra_seats integer;
begin
  select free_value into base_members
  from public.plan_limits
  where limit_key = 'householdMembers';

  select quantity into extra_seats
  from public.household_seat_addons
  where household_id = new.household_id and status in ('active', 'trialing');

  if (select count(*) from public.household_members where household_id = new.household_id)
     >= coalesce(base_members, 2) + coalesce(extra_seats, 0) then
    raise exception 'household member limit reached';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_household_member_limit() from public;

update public.plan_limits set pro_value = 2 where limit_key = 'householdMembers';

insert into public.schema_migrations (version) values ('0128_fix_household_member_limit')
on conflict (version) do nothing;
