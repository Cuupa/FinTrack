-- Named savings goals (ROADMAP item #6, flag `goals`): a target amount,
-- optionally by a target date, whose progress either mirrors a linked
-- account's current balance or is entered manually. `linked_account_id` is
-- nullable and set null on account delete (a goal survives its linked
-- account being deleted -- it just falls back to manual tracking, mirroring
-- `contracts.category_id`'s "still means something" precedent).
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  target_amount numeric not null,
  target_date date,
  linked_account_id uuid references public.accounts (id) on delete set null,
  manual_current_amount numeric,
  created_at timestamptz not null default now()
);
create index if not exists goals_user_id_idx on public.goals (user_id);
create index if not exists goals_linked_account_id_idx on public.goals (linked_account_id);

alter table public.goals enable row level security;

drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seeded DISABLED (dark-launched): named savings goals only appear once the
-- owner flips the flag on.
insert into public.feature_flags (flag, enabled, description) values
  ('goals', false, 'Named savings goals with progress tracking, linked to an account or entered manually')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0085_goals')
on conflict (version) do nothing;
