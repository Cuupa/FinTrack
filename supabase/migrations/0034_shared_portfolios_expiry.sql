-- Migration: user-chosen share link expiry. `expires_at` (added in migration
-- 0031) was reserved but unenforced — the RLS select policy allowed reading
-- any row regardless of expiry. This flips the read policy so an expired row
-- is simply invisible (same publishable key, no app-side branching needed):
-- null expires_at = never expires, otherwise readable only while in the
-- future. Idempotent.

drop policy if exists "shared portfolios readable" on public.shared_portfolios;
create policy "shared portfolios readable" on public.shared_portfolios
  for select using (expires_at is null or expires_at > now());

insert into public.schema_migrations (version) values ('0034_shared_portfolios_expiry')
on conflict (version) do nothing;
