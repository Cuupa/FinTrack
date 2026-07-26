-- Household as a paid family plan (MONETIZATION.md Phase 4 + ROADMAP #13).
--
-- The problem this fixes: household sharing is enforced by RLS
-- (household_peer_ids(), migrations 0092/0093), and RLS knew nothing about
-- plans. Locking the `household` flag to 'pro' therefore only hid the
-- /household management page client-side: once two people were in a
-- household, a downgrade kept every shared row visible on the dashboard,
-- /spending, /goals and everywhere else. The paywall leaked the moment it
-- mattered.
--
-- Shape chosen (owner decision, 2026-07-26): ONE Pro subscription per
-- household, members free. So the gate is per-HOUSEHOLD ("does at least one
-- member have Pro"), never per-member, and it is re-evaluated on every read
-- rather than only at join time.
--
-- The gate is conditional on the flag's own tier: it only bites while
-- feature_flags.required_plan = 'pro' for flag 'household'. Every flag is
-- seeded 'free', so this migration changes NOTHING in prod until the owner
-- re-tiers the row on /admin/flags -- and that single toggle then flips both
-- the client-side teaser and this DB enforcement, with no second switch to
-- forget.

-- Mirrors resolvePlan (lib/billing/plan.ts) exactly: active/trialing, plus a
-- 7-day past_due grace, plus a standalone plan_grants path ("gratitude
-- premium"). The subscription branch deliberately ignores `subscriptions.plan`
-- because resolvePlan does; the grant branch requires plan = 'pro' because
-- resolvePlan does. Keep the two in step -- they are the same rule expressed
-- twice, once for the client and once for RLS.
create or replace function public.user_has_pro(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.plan_grants g
    where g.user_id = p_user_id
      and g.plan = 'pro'
      and (g.expires_at is null or g.expires_at > now())
  ) or exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and (
        s.status in ('active', 'trialing')
        or (s.status = 'past_due' and now() < s.current_period_end + interval '7 days')
      )
  );
$$;
-- NOT granted to authenticated, and revoked from the PUBLIC default: a
-- client-callable version would let any signed-in user probe whether an
-- arbitrary user id pays. Only the security-definer functions below call it,
-- and they run as the owner, which needs no grant.
revoke execute on function public.user_has_pro(uuid) from public;

-- Is the household tier actually being sold right now? Missing row or a
-- lagging migration reads as 'free' => no gate, matching the fail-open rule
-- the rest of the flag/limit resolution follows.
create or replace function public.household_pro_required()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select required_plan = 'pro' from public.feature_flags where flag = 'household'),
    false
  );
$$;
revoke execute on function public.household_pro_required() from public;

create or replace function public.household_has_pro(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = p_household_id and public.user_has_pro(hm.user_id)
  );
$$;
revoke execute on function public.household_has_pro(uuid) from public;

-- The single predicate every sharing path consults.
create or replace function public.household_sharing_enabled(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_household_id is not null
    and (not public.household_pro_required() or public.household_has_pro(p_household_id));
$$;
revoke execute on function public.household_sharing_enabled(uuid) from public;

-- Client-readable aggregate for the caller's OWN household only, so
-- /household can say "sharing is paused, nobody here has Pro" instead of
-- silently showing two disconnected datasets (owner rule: never leave a
-- failed state looking like a normal one). It discloses nothing a member
-- doesn't already know -- whether their own household is sharing -- and never
-- which member pays.
create or replace function public.household_sharing_active()
returns boolean language sql stable security definer set search_path = public as $$
  select public.household_sharing_enabled(public.my_household_id());
$$;
grant execute on function public.household_sharing_active() to authenticated;

-- The enforcement point. Returning an empty set collapses every
-- household-shared policy back to plain self-ownership: nothing is deleted,
-- nothing is reassigned, both members simply see their own data again until
-- someone subscribes.
create or replace function public.household_peer_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  with mine as (
    select household_id from public.household_members where user_id = auth.uid() limit 1
  )
  select hm.user_id
  from public.household_members hm
  join mine on mine.household_id = hm.household_id
  where public.household_sharing_enabled(mine.household_id);
$$;
grant execute on function public.household_peer_ids() to authenticated;

-- Joining also needs Pro somewhere, otherwise a free pair could sit in a
-- household that shares nothing and looks broken. Either side may carry it:
-- the creator/owner (the normal case) or the person accepting the invite (a
-- Pro user joining their partner's free account) -- household_peer_ids above
-- keeps the invariant "at least one member has Pro" true either way.
drop policy if exists "join household" on public.household_members;
create policy "join household" on public.household_members
  for insert with check (
    user_id = auth.uid()
    and (
      exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid())
      or exists (
        select 1 from public.household_invites i
        where i.household_id = household_members.household_id
          and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and i.status = 'pending'
      )
    )
    and (
      not public.household_pro_required()
      or public.user_has_pro(auth.uid())
      or public.household_has_pro(household_id)
    )
  );

-- Fail loudly at invite time rather than creating invitations that could never
-- lead to sharing.
drop policy if exists "member creates invite" on public.household_invites;
create policy "member creates invite" on public.household_invites
  for insert with check (
    invited_by = auth.uid()
    and household_id = public.my_household_id()
    and public.household_sharing_enabled(household_id)
  );

-- Household size as an ordinary plan limit (people, including yourself), so
-- the cap rides the existing resolveLimit/atLimit machinery instead of a
-- second bespoke rule. Seeded unlimited on both plans like every other key:
-- nothing changes until the owner sets a number on /admin/site.
insert into public.plan_limits (limit_key, free_value, pro_value) values
  ('householdMembers', null, null)
on conflict (limit_key) do nothing;

insert into public.schema_migrations (version) values ('0101_household_pro')
on conflict (version) do nothing;
