-- Harden BYO LLM key storage (P0 security). SupabaseStore runs client-side, so
-- the browser (authenticated role) was reading llm_settings.api_key in plaintext
-- via RLS on every load. The browser must never see the stored key: it selects
-- provider/model/api_key_last4 only, and /api/llm reads the full key server-side
-- via the service role for account scope. See CLAUDE.md (LLM assistant) and
-- FINTRACK_STABILIZATION_PLAN.md 0.1.

alter table public.llm_settings
  add column if not exists api_key_last4 text;

update public.llm_settings
  set api_key_last4 = right(api_key, 4)
  where api_key_last4 is null and api_key is not null;

-- Column-level SELECT: revoke the table-wide grant, re-grant only the non-secret
-- columns. INSERT/UPDATE/DELETE stay (writes never read the key back), so the
-- browser can still upsert and delete its own row under RLS. Idempotent.
revoke select on public.llm_settings from authenticated;
revoke select on public.llm_settings from anon;
grant select (user_id, provider, model, api_key_last4, updated_at)
  on public.llm_settings to authenticated;
