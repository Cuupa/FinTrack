-- Admin authz foundation: an explicit allowlist table (no role/claim hacks),
-- a SECURITY DEFINER helper other policies can call, and an audit trail for
-- admin-performed mutations. No seed row here on purpose: the operator adds
-- their own auth.users id post-deploy:
--   insert into public.admins (user_id) values ('<auth.users uuid>');
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- A user may only ever see whether THEY are an admin (used by the client's
-- useIsAdmin hook to gate the /admin shell), never the full admin list.
drop policy if exists "own admin row" on public.admins;
create policy "own admin row" on public.admins for select using (user_id = auth.uid());

-- SECURITY DEFINER so it can be referenced from other tables' RLS policies
-- without those policies needing their own read access to public.admins.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_email text,
  action text not null,
  target text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
drop policy if exists "admin audit readable" on public.admin_audit;
create policy "admin audit readable" on public.admin_audit for select using (public.is_admin());
create index if not exists admin_audit_created_at_idx on public.admin_audit (created_at desc);

insert into public.schema_migrations (version) values ('0050_admin_authz')
on conflict (version) do nothing;
