-- Migration: let a user delete their own shares, so creating a new share can
-- void all their previous links. Idempotent.

drop policy if exists "shared portfolios owner delete" on public.shared_portfolios;
create policy "shared portfolios owner delete" on public.shared_portfolios
  for delete using (owner = auth.uid());

insert into public.schema_migrations (version) values ('0020_shared_owner_delete')
on conflict (version) do nothing;
