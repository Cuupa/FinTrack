-- Repair: `plan_grants` is missing in production.
--
-- Symptom (2026-07-26): granting a user Pro on /admin/billing fails, the
-- browser shows `GET /rest/v1/plan_grants?... 404` (PostgREST 42P01, the
-- relation does not exist) and `GET /api/admin/billing/grants 500` (the
-- admin route surfacing the same Postgres error), and the grants card sits
-- in its skeleton forever.
--
-- Cause: the table only ever landed in supabase/schema.sql (the fresh-install
-- path, "0068_plan_grants"); the deployed database was never migrated, so
-- every read of it fails. This file is the missing evolve-an-existing-DB
-- step, statement for statement identical to the schema.sql block, and fully
-- idempotent -- applying it to a database that already has the table is a
-- no-op.
--
-- "Gratitude premium" (MONETIZATION.md): grant a user Pro independent of any
-- Stripe subscription, with an optional end date or no expiry at all.
-- Written only by the service role (/api/admin/billing/grants) -- same
-- posture as `subscriptions`: the client can only read its own rows.
-- `resolvePlan` (lib/billing/plan.ts) treats an active grant as an
-- independent path to "pro", alongside the existing Stripe path.
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

drop policy if exists "own plan grants" on public.plan_grants;
create policy "own plan grants" on public.plan_grants
  for select using (auth.uid() = user_id);

insert into public.schema_migrations (version) values
  ('0068_plan_grants'),
  ('0099_plan_grants_repair')
on conflict (version) do nothing;

-- A table created out of band leaves PostgREST's schema cache stale, which
-- keeps the REST 404 alive even once the relation exists. Force a reload so
-- the fix takes effect without waiting for a restart.
notify pgrst, 'reload schema';
