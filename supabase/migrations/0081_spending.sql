-- Spending transactions & categories (ROADMAP item #2, flag `spending`):
-- expense/income against an `accounts` row, categorised. `spending_categories`
-- is a flat user-owned taxonomy (`group_name` + `name`, stable ids) -- lighter
-- than `tag_groups`/`asset_tags` (migration 0062) since a transaction carries
-- exactly one category, not many values per group, so no junction table is
-- needed. `spending_transactions.category_id` sets null on category delete
-- (losing the category shouldn't lose the transaction); deleting the account
-- cascades its transactions. `recurring_id` is a bare nullable uuid for now --
-- the `contracts` table (ROADMAP item #5) doesn't exist yet, so the FK
-- constraint is added alongside that migration instead of forward-referencing
-- a table that isn't there. Both ride the DataStore seam like accounts: Guest
-- Mode keeps them in the localStorage blob, registered users get these tables
-- (own-row RLS, FK cascade on account delete).
create table if not exists public.spending_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_name text not null,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists spending_categories_unique_key
  on public.spending_categories (user_id, group_name, name);
create index if not exists spending_categories_user_id_idx on public.spending_categories (user_id);

create table if not exists public.spending_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  category_id uuid references public.spending_categories (id) on delete set null,
  date date not null,
  amount numeric not null,
  payee text not null,
  note text,
  recurring_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists spending_transactions_account_id_idx on public.spending_transactions (account_id);
create index if not exists spending_transactions_category_id_idx on public.spending_transactions (category_id);
create index if not exists spending_transactions_user_id_idx on public.spending_transactions (user_id);

alter table public.spending_categories enable row level security;
alter table public.spending_transactions enable row level security;

drop policy if exists "own spending categories" on public.spending_categories;
create policy "own spending categories" on public.spending_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own spending transactions" on public.spending_transactions;
create policy "own spending transactions" on public.spending_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seeded DISABLED (dark-launched): the Spending surface only appears once the
-- owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('spending', false, 'Categorised expense/income transactions against balance accounts')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0081_spending')
on conflict (version) do nothing;
