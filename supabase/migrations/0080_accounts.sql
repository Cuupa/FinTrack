-- Accounts & liabilities (ROADMAP item #1, flag `accounts`): the keystone that
-- lets net worth become *everything*, including debt. An `accounts` row is a
-- balance the user sets (checking/savings/credit/loan/mortgage/other) rather
-- than a holding derived from trades; liabilities (`is_liability`) subtract
-- from net worth. `account_balances` holds dated balance readings (a
-- carry-forward step series, mirroring `asset_valuations` for OTHER assets):
-- `opening_balance` at `opened_on` is the implicit first point, later readings
-- override it. Both ride the DataStore seam like tags/valuations: Guest Mode
-- keeps them in the localStorage blob, registered users get these tables
-- (own-row RLS, FK cascade on account delete). `setAccountBalances` replaces
-- the full set for an account by delete-then-insert, so replay is idempotent.
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'checking',
  currency text,
  is_liability boolean not null default false,
  opening_balance numeric not null default 0,
  opened_on date not null,
  created_at timestamptz not null default now()
);
alter table public.accounts
  drop constraint if exists accounts_kind_check;
alter table public.accounts
  add constraint accounts_kind_check check (
    kind in ('checking', 'savings', 'credit', 'loan', 'mortgage', 'other_asset', 'other_liability')
  );
create index if not exists accounts_user_id_idx on public.accounts (user_id);

create table if not exists public.account_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  balance_on date not null,
  balance numeric not null,
  created_at timestamptz not null default now()
);
create unique index if not exists account_balances_unique_key
  on public.account_balances (account_id, balance_on);
create index if not exists account_balances_account_id_idx on public.account_balances (account_id);
create index if not exists account_balances_user_id_idx on public.account_balances (user_id);

alter table public.accounts enable row level security;
alter table public.account_balances enable row level security;

drop policy if exists "own accounts" on public.accounts;
create policy "own accounts" on public.accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own account balances" on public.account_balances;
create policy "own account balances" on public.account_balances
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seeded DISABLED (dark-launched): the Accounts surface + net-worth fold only
-- appear once the owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('accounts', false, 'Balance accounts & liabilities (checking/savings/credit/loan/mortgage) folded into net worth')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0080_accounts')
on conflict (version) do nothing;
