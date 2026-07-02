-- Migration: app-wide settings with a configurable registration cap. When the
-- number of users reaches `max_users`, signup is closed; null disables the
-- limit. The owner changes it on a moment's notice via:
--   update public.app_settings set max_users = 50;   -- or NULL to disable
-- Idempotent.

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  max_users int,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
alter table public.app_settings enable row level security;

create or replace function public.registration_open()
returns boolean
language sql
security definer
set search_path = public
as $$
  select case
    when (select max_users from public.app_settings where id = 1) is null then true
    else (select count(*) from auth.users)
       < (select max_users from public.app_settings where id = 1)
  end;
$$;
grant execute on function public.registration_open() to anon, authenticated;

insert into public.schema_migrations (version) values ('0025_app_settings')
on conflict (version) do nothing;
