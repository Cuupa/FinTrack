-- Savings plans (Sparpläne): recurring buy rules. Due occurrences are
-- materialized client-side as ordinary BUY transactions after an explicit
-- user review; `last_run_date` advances so each occurrence happens once.
-- `frequency` (not `interval`) to steer clear of the reserved type name.
create table if not exists public.savings_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  amount numeric not null check (amount > 0),
  frequency text not null check (frequency in ('WEEKLY', 'MONTHLY', 'QUARTERLY')),
  start_date date not null,
  active boolean not null default true,
  last_run_date date,
  created_at timestamptz not null default now()
);
create index if not exists savings_plans_user_id_idx on public.savings_plans (user_id);

alter table public.savings_plans enable row level security;
drop policy if exists "own savings plans" on public.savings_plans;
create policy "own savings plans" on public.savings_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.feature_flags (flag, description) values
  ('savingsPlans', 'Savings plans (recurring buys) card on the dashboard')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0038_savings_plans')
on conflict (version) do nothing;
