-- Household member list showed the raw email as identity, even for the owner.
-- Surface a display name instead (email is the fallback). Return-type change,
-- so the old signature is dropped by name first.

drop function if exists public.household_member_emails();

create or replace function public.household_member_emails()
returns table (user_id uuid, email text, display_name text)
language sql stable security definer set search_path = public, auth as $$
  select
    hm.user_id,
    u.email,
    coalesce(
      p.display_name,
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name'
    ) as display_name
  from public.household_members hm
  join auth.users u on u.id = hm.user_id
  left join public.profiles p on p.id = hm.user_id
  where hm.household_id = public.my_household_id();
$$;
grant execute on function public.household_member_emails() to authenticated;
