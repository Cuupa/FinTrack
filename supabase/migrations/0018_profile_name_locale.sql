-- Migration: per-user display name / nickname and preferred UI locale on the
-- profile. Idempotent.

alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists locale text;

insert into public.schema_migrations (version) values ('0018_profile_name_locale')
on conflict (version) do nothing;
