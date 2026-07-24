-- Recurring-charge contract register (ROADMAP item #5, flag `contracts`):
-- subscriptions/insurance/rent tracked as named, recurring commitments with
-- an optional renewal date + cancellation-notice window, so the UI can flag
-- an approaching cancellation deadline. Built to double as the base for
-- insurance (ROADMAP #10, a typed contract) later -- kept generic here.
-- `category_id` reuses the existing spending taxonomy; nullable and set null
-- on category delete (mirrors spending_transactions -- a contract without a
-- category still means something, unlike a budget).
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  amount numeric not null,
  interval text not null,
  renewal_date date,
  cancellation_notice_days integer,
  category_id uuid references public.spending_categories (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contracts_user_id_idx on public.contracts (user_id);
create index if not exists contracts_category_id_idx on public.contracts (category_id);

alter table public.contracts enable row level security;

drop policy if exists "own contracts" on public.contracts;
create policy "own contracts" on public.contracts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seeded DISABLED (dark-launched): the contract register only appears once
-- the owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('contracts', false, 'Recurring-charge detection and a contract/subscription register')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0084_contracts')
on conflict (version) do nothing;
