-- Repair migration: columns that were added to an ALREADY-SHIPPED table but
-- only ever written INSIDE that table's `create table if not exists (...)`
-- block in supabase/schema.sql. On a fresh install they exist; on an existing
-- database the create is a no-op, so the column never arrives.
--
-- Why this mattered in production: schema.sql then went on to
-- `create index ... on public.error_logs (level)`, which aborts with 42703
-- ("column level does not exist"). The Supabase SQL editor runs the script in
-- ONE transaction, so that single statement rolled the WHOLE apply back --
-- including the correctly guarded `spending_transactions.transfer_account_id`
-- further up the file. The app then failed its portfolio load against a
-- column the code selects but the database never got.
--
-- Every statement here is idempotent and safe to re-run.

-- error_logs.level (migration 0069): severity classification, the primary
-- field and the /admin/errors filter. Without it the index + check constraint
-- below abort the entire schema apply.
alter table public.error_logs
  add column if not exists level text not null default 'error';

create index if not exists error_logs_level_idx on public.error_logs (level);
alter table public.error_logs drop constraint if exists error_logs_level_check;
alter table public.error_logs add constraint error_logs_level_check
  check (level in ('debug', 'info', 'warn', 'error', 'fatal'));

-- goals: depot-tracking columns (migration 0097) and the sub-goal self-FK
-- (0098). SupabaseStore.load() selects all three, so a database missing them
-- fails the whole portfolio load, not just the /goals page.
alter table public.goals
  add column if not exists tracks_investments boolean not null default false;
alter table public.goals
  add column if not exists linked_portfolio_id uuid references public.portfolios (id) on delete set null;
alter table public.goals
  add column if not exists parent_goal_id uuid references public.goals (id) on delete cascade;

create index if not exists goals_linked_portfolio_id_idx on public.goals (linked_portfolio_id);
create index if not exists goals_parent_goal_id_idx on public.goals (parent_goal_id);

-- spending_categories.tax_deductible (ROADMAP #11, flag `taxPack`) and
-- spending_transactions.recurring_id (migration 0095, contract booking):
-- both are in the load() SELECT list.
alter table public.spending_categories
  add column if not exists tax_deductible boolean;
alter table public.spending_transactions
  add column if not exists recurring_id uuid;

-- The transfer marker (migration 0096) is correctly guarded in schema.sql,
-- but a rolled-back apply never reached it -- restate it here so this one
-- migration is enough to make an existing database load again.
alter table public.spending_transactions
  add column if not exists transfer_account_id uuid references public.accounts (id) on delete set null;

create index if not exists spending_transactions_transfer_account_id_idx
  on public.spending_transactions (transfer_account_id);

-- Owner-editable secrets/config added to already-created singleton rows:
-- app_settings Stripe keys (0067) + VAPID keys (0076), billing_config
-- display prices (0070).
alter table public.app_settings
  add column if not exists stripe_secret_key text;
alter table public.app_settings
  add column if not exists stripe_webhook_secret text;
alter table public.app_settings
  add column if not exists vapid_public_key text;
alter table public.app_settings
  add column if not exists vapid_private_key text;
alter table public.app_settings
  add column if not exists vapid_subject text;

alter table public.billing_config
  add column if not exists price_monthly_display text;
alter table public.billing_config
  add column if not exists price_yearly_display text;

insert into public.schema_migrations (version) values
  ('0099_schema_repair_late_columns')
on conflict (version) do nothing;
