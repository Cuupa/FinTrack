-- MONETIZATION.md "gratitude premium": grant a user Pro independent of any
-- Stripe subscription (e.g. a manual thank-you reward), with an optional
-- end date or no expiry at all. Written only by the service role (the
-- /api/admin/billing/grants routes), same posture as
-- `subscriptions`: the client can only read its own rows. `resolvePlan`
-- (lib/billing/plan.ts) treats an active grant as an independent path to
-- "pro", alongside the existing Stripe-subscription path. Idempotent.

create table if not exists public.plan_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null default 'pro',
  expires_at timestamptz,  -- null = infinite
  note text,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists plan_grants_user_id_idx on public.plan_grants (user_id);

alter table public.plan_grants enable row level security;

-- Select-own only, no client insert/update/delete policies (service role
-- bypasses RLS; writes happen only server-side).
drop policy if exists "own plan grants" on public.plan_grants;
create policy "own plan grants" on public.plan_grants
  for select using (auth.uid() = user_id);

insert into public.schema_migrations (version) values ('0068_plan_grants')
on conflict (version) do nothing;
