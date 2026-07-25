-- Household / collaboration (ROADMAP item #13, flag `household`): shared
-- read/write access to another registered user's financial data. v1 caps
-- membership at ONE household per user (household_members.user_id has a
-- unique index) -- this sidesteps "which household's accounts am I seeing"
-- ambiguity entirely; multi-household support is a bigger v2 decision, not
-- addressed here.
--
-- No transactional-email infra exists in this app (Supabase Auth's own
-- confirmation emails are the only mail sent today), so invites are NOT
-- emailed: an invite is a row keyed by the invitee's email; the invited user
-- sees it in-app (their own signed-in email matches a pending invite,
-- RLS-visible only to that email) and accepts/declines from there.
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now()
);
-- One household per user (v1 scope, see module comment above).
create unique index if not exists household_members_one_per_user
  on public.household_members (user_id);
create index if not exists household_members_household_id_idx
  on public.household_members (household_id);

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now()
);
create index if not exists household_invites_email_idx
  on public.household_invites (lower(email));
create index if not exists household_invites_household_id_idx
  on public.household_invites (household_id);

-- SECURITY DEFINER helpers so per-table RLS policies (accounts today, more
-- tables in later rounds -- see migration 0092's module comment) can extend
-- "own row" to "own row OR a household peer's row" without those policies
-- needing their own read access to household_members, and without
-- household_members' own policies becoming self-referential (a function
-- owned by the table owner bypasses that table's RLS internally).
create or replace function public.my_household_id()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from public.household_members where user_id = auth.uid() limit 1;
$$;
grant execute on function public.my_household_id() to authenticated;

create or replace function public.household_peer_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from public.household_members
  where household_id = (select household_id from public.household_members where user_id = auth.uid() limit 1);
$$;
grant execute on function public.household_peer_ids() to authenticated;

create or replace function public.is_household_owner(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid() and role = 'owner'
  );
$$;
grant execute on function public.is_household_owner(uuid) to authenticated;

-- auth.users is not directly selectable by clients; this exposes only the
-- emails of people the caller already shares a household with (mutual
-- disclosure -- they already know each other's email from the invite),
-- never the full user list.
create or replace function public.household_member_emails()
returns table (user_id uuid, email text)
language sql stable security definer set search_path = public, auth as $$
  select hm.user_id, u.email
  from public.household_members hm
  join auth.users u on u.id = hm.user_id
  where hm.household_id = public.my_household_id();
$$;
grant execute on function public.household_member_emails() to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

-- `or created_by = auth.uid()` matters at creation time: the creator's own
-- household_members row (role owner) doesn't exist yet when they insert it,
-- so my_household_id() is still null and, without this clause, the
-- household_members INSERT policy's "did I create this household" subquery
-- below would never see the household row it just created (RLS on a plain
-- subquery is evaluated against the referencing role's own visibility,
-- not bypassed just because the row matches created_by).
drop policy if exists "member households" on public.households;
create policy "member households" on public.households
  for select using (id = public.my_household_id() or created_by = auth.uid());
drop policy if exists "create household" on public.households;
create policy "create household" on public.households
  for insert with check (created_by = auth.uid());
drop policy if exists "owner updates household" on public.households;
create policy "owner updates household" on public.households
  for update using (public.is_household_owner(id));
drop policy if exists "owner deletes household" on public.households;
create policy "owner deletes household" on public.households
  for delete using (public.is_household_owner(id));

drop policy if exists "view household members" on public.household_members;
create policy "view household members" on public.household_members
  for select using (household_id = public.my_household_id());
drop policy if exists "join household" on public.household_members;
create policy "join household" on public.household_members
  for insert with check (
    user_id = auth.uid()
    and (
      -- Creating your own household (first member = the creator, role owner).
      exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid())
      -- Or accepting a pending invite addressed to your own signed-in email.
      or exists (
        select 1 from public.household_invites i
        where i.household_id = household_members.household_id
          and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and i.status = 'pending'
      )
    )
  );
drop policy if exists "leave or owner removes member" on public.household_members;
create policy "leave or owner removes member" on public.household_members
  for delete using (user_id = auth.uid() or public.is_household_owner(household_id));
drop policy if exists "owner updates member role" on public.household_members;
create policy "owner updates member role" on public.household_members
  for update using (public.is_household_owner(household_id))
  with check (public.is_household_owner(household_id));

drop policy if exists "view own sent or received invites" on public.household_invites;
create policy "view own sent or received invites" on public.household_invites
  for select using (
    invited_by = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.is_household_owner(household_id)
  );
drop policy if exists "member creates invite" on public.household_invites;
create policy "member creates invite" on public.household_invites
  for insert with check (invited_by = auth.uid() and household_id = public.my_household_id());
drop policy if exists "invitee or owner updates invite" on public.household_invites;
create policy "invitee or owner updates invite" on public.household_invites
  for update using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) -- invitee accepts/declines
    or public.is_household_owner(household_id) -- owner revokes
  );

-- Seeded DISABLED (dark-launched): household creation/invites/membership
-- only appear once the owner flips the flag on. Shared access to accounts
-- (migration 0092) is gated by the same flag at the UI layer; the RLS
-- policies themselves are always active but are a no-op for anyone not in a
-- household (household_peer_ids() returns an empty set).
insert into public.feature_flags (flag, enabled, description) values
  ('household', false, 'Household collaboration: shared households with invite/accept, and household-peer access to accounts (more entities follow in later rounds)')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0091_households')
on conflict (version) do nothing;
