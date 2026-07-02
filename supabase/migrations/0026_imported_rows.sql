-- Migration: remember which broker-CSV rows were already imported (by fuzzy
-- fingerprint), so re-uploading the same export doesn't re-surface merged
-- transactions as conflicts. Idempotent.

create table if not exists public.imported_rows (
  user_id uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, fingerprint)
);

alter table public.imported_rows enable row level security;
drop policy if exists "own imported rows" on public.imported_rows;
create policy "own imported rows" on public.imported_rows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.schema_migrations (version) values ('0026_imported_rows')
on conflict (version) do nothing;
