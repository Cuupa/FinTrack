-- Web push notifications (COMPETITION.md F5): dividend pay-day and
-- savings-plan-due reminders only. Registered users opt in per event type in
-- settings; a daily cron computes due events and pushes them. Strictly no
-- marketing pushes.

-- VAPID keys live in app_settings (id=1, RLS enabled with zero policies -> only
-- the service role reaches them, migration 0067), DB-first with an env fallback
-- exactly like the Stripe keys. The public key is not secret (it is handed to
-- the browser to subscribe); the private key signs the push JWT server-side.
alter table public.app_settings add column if not exists vapid_public_key text;
alter table public.app_settings add column if not exists vapid_private_key text;
alter table public.app_settings add column if not exists vapid_subject text;

-- One row per browser push subscription; a user may have several (one per
-- device). Prefs are per-subscription. `last_notified_on` de-dupes so the cron
-- never pushes the same subscription twice in a day.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  notify_dividends boolean not null default false,
  notify_savings boolean not null default false,
  last_notified_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
-- A user manages only their own subscriptions; the cron reads/writes all rows
-- via the service role (bypasses RLS).
drop policy if exists "own push subs selectable" on public.push_subscriptions;
create policy "own push subs selectable" on public.push_subscriptions
  for select using (auth.uid() = user_id);
drop policy if exists "own push subs insertable" on public.push_subscriptions;
create policy "own push subs insertable" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
drop policy if exists "own push subs updatable" on public.push_subscriptions;
create policy "own push subs updatable" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own push subs deletable" on public.push_subscriptions;
create policy "own push subs deletable" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- Seeded DISABLED (separate insert so the default-true column doesn't enable
-- it): push ships off; the owner flips it on once VAPID keys are set.
insert into public.feature_flags (flag, enabled, description) values
  ('pushNotifications', false, 'Web push reminders (dividend pay-day, savings-plan due)')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0076_push_notifications')
on conflict (version) do nothing;
