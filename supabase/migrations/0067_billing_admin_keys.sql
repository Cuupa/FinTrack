-- MONETIZATION.md Phase 2: Stripe secret key + webhook secret editable at
-- runtime from /admin/billing (round 2026-07-19b). These are real secrets, so
-- they live in `app_settings` (RLS enabled, zero policies: unreadable even
-- with the publishable key, only the service role reaches it) rather than
-- `billing_config` (world-readable). Resolution is DB-value-wins, env-var
-- fallback (`lib/server/billing-keys.ts`) so existing env-only deploys keep
-- working unchanged. Idempotent.

alter table public.app_settings add column if not exists stripe_secret_key text;
alter table public.app_settings add column if not exists stripe_webhook_secret text;

insert into public.schema_migrations (version) values ('0067_billing_admin_keys')
on conflict (version) do nothing;
