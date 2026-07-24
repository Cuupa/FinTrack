-- Budgets (ROADMAP item #4, flag `budgets`): a monthly spending cap per
-- category -- the "category caps + flow" philosophy picked over YNAB-style
-- envelopes (ROADMAP's Open decisions #3). One budget per category
-- (unique user_id+category_id: setting a new cap replaces the old one rather
-- than accumulating rows), amount in the profile's base currency since
-- `lib/finance/spending.ts` already converts category totals to base before
-- aggregating (toBaseCurrency). Deleting the category deletes its budget --
-- unlike spending_transactions.category_id (which sets null so the
-- transaction survives), a budget with no category means nothing.
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.spending_categories (id) on delete cascade,
  amount numeric not null,
  created_at timestamptz not null default now()
);
create unique index if not exists budgets_unique_category
  on public.budgets (user_id, category_id);
create index if not exists budgets_user_id_idx on public.budgets (user_id);

alter table public.budgets enable row level security;

drop policy if exists "own budgets" on public.budgets;
create policy "own budgets" on public.budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seeded DISABLED (dark-launched): budget bars only appear once the owner
-- flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('budgets', false, 'Monthly per-category spending caps with budget-vs-actual bars')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0083_budgets')
on conflict (version) do nothing;
