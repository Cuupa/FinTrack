-- LLM assistant config (provider, model, API key) rides the full DataStore
-- seam like tags (migration 0062, owner override of LLM_INTEGRATION.md's
-- earlier "localStorage only" decision): registered users persist it here,
-- Guest Mode keeps it in the localStorage blob (lib/store/local-store.ts).
-- One row per user (user_id is the primary key) — `saveLlmConfig` upserts on
-- save, deletes the row on removal, so a save is always replace-set and
-- replay-idempotent regardless of how many times it's applied.
create table if not exists public.llm_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null,
  model text not null,
  api_key text not null,
  updated_at timestamptz not null default now()
);

alter table public.llm_settings enable row level security;
drop policy if exists "own llm settings" on public.llm_settings;
create policy "own llm settings" on public.llm_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.schema_migrations (version) values ('0064_llm_settings')
on conflict (version) do nothing;
