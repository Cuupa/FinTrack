-- Migration: site-wide public config, starting with the operator identity
-- shown on the legal pages (/impressum, /datenschutz). Same shape/policy as
-- `feature_flags`: world-readable reference data, written by the owner only
-- via SQL/dashboard (service role bypasses RLS) — no insert/update/delete
-- policy for anon/authenticated. A key missing or empty means "not filled in
-- yet"; the UI falls back to a placeholder in that case. Idempotent.
--
-- Fill in the operator's identity with, e.g.:
--   update public.site_config set value = 'Jane Doe', updated_at = now() where key = 'legal_name';
--   update public.site_config set value = 'Musterstraße 1', updated_at = now() where key = 'legal_street';
--   update public.site_config set value = '12345 Musterstadt', updated_at = now() where key = 'legal_city';
--   update public.site_config set value = 'contact@example.com', updated_at = now() where key = 'legal_email';

create table if not exists public.site_config (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.site_config enable row level security;

drop policy if exists "site config readable" on public.site_config;
create policy "site config readable" on public.site_config
  for select using (true);

insert into public.site_config (key, value) values
  ('legal_name', ''),
  ('legal_street', ''),
  ('legal_city', ''),
  ('legal_email', '')
on conflict (key) do nothing;

insert into public.schema_migrations (version) values ('0033_site_config')
on conflict (version) do nothing;
