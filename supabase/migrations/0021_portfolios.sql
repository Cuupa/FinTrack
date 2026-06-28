-- Migration: multiple portfolios per user. A `portfolios` table + a
-- `transactions.portfolio_id` so each transaction belongs to one portfolio.
-- Existing accounts get a default "Main" portfolio and their transactions are
-- assigned to it (done lazily by the app on first load). Idempotent.

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Main',
  created_at timestamptz not null default now()
);
create index if not exists portfolios_user_id_idx on public.portfolios (user_id);

alter table public.transactions
  add column if not exists portfolio_id uuid references public.portfolios (id) on delete cascade;
create index if not exists transactions_portfolio_id_idx on public.transactions (portfolio_id);

alter table public.portfolios enable row level security;
drop policy if exists "own portfolios" on public.portfolios;
create policy "own portfolios" on public.portfolios
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.schema_migrations (version) values ('0021_portfolios')
on conflict (version) do nothing;
