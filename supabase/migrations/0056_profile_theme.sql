-- Adds the user's explicit light/dark theme choice to the profile, so it
-- follows the account across devices (mirrors locale's persistence, see
-- 0018_profile_name_locale). Null means "no explicit choice, follow the
-- device/OS preference"; the value is applied by components/theme-sync.tsx.
alter table public.profiles add column if not exists theme text;

insert into public.schema_migrations (version) values ('0056_profile_theme')
on conflict (version) do nothing;
