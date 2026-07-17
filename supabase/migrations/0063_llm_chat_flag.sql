-- Feature flag for the BYO-key AI assistant chat (lib/llm + /api/llm proxy +
-- the chat bubble). Seeded DISABLED — unlike the export flags (0047), this one
-- ships off by default and the owner flips it on per-user or globally via SQL.
-- No new tables: the API key lives only in the browser (localStorage), the
-- proxy is stateless, and requests run entirely client-side against data in
-- memory. Idempotent (do nothing on conflict, so re-runs never re-enable it).
insert into public.feature_flags (flag, enabled, description) values
  ('llmChat', false, 'AI assistant chat (bring-your-own LLM API key)')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0063_llm_chat_flag')
on conflict (version) do nothing;
