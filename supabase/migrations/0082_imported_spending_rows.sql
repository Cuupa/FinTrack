-- Bank-statement import -> spending (ROADMAP item #3, flag `spending`):
-- fingerprints of already-imported spending-CSV rows, mirroring
-- `imported_rows` (migration 0026/0028) but tied to `spending_transactions`
-- instead of `transactions` -- the two entities are unrelated tables, so a
-- single fingerprint table can't FK to both. Deleting the spending
-- transaction it created (directly, or via account/portfolio-less cascade)
-- drops the fingerprint too, so a re-imported statement doesn't wrongly show
-- the row as "already imported" once it's gone.
create table if not exists public.imported_spending_rows (
  user_id uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,
  spending_transaction_id uuid references public.spending_transactions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, fingerprint)
);
create index if not exists imported_spending_rows_transaction_id_idx
  on public.imported_spending_rows (spending_transaction_id);

alter table public.imported_spending_rows enable row level security;

drop policy if exists "own imported spending rows" on public.imported_spending_rows;
create policy "own imported spending rows" on public.imported_spending_rows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.schema_migrations (version) values ('0082_imported_spending_rows')
on conflict (version) do nothing;
