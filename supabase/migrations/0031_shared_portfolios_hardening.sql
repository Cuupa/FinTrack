-- Migration: harden shared_portfolios' write path. The `insert with check
-- (true)` policy let anyone write arbitrary-sized rows with no rate limit —
-- app/api/share/route.ts now writes with the secret key instead and enforces
-- a size cap + a best-effort DB-backed rate limit itself, so the open policy
-- is no longer needed and is dropped here. Idempotent.

alter table public.shared_portfolios
  add column if not exists creator_ip text,
  add column if not exists expires_at timestamptz;  -- null = never expires; TTL/cleanup deliberately NOT built (product decision deferred)

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shared_portfolios_payload_size') then
    alter table public.shared_portfolios
      add constraint shared_portfolios_payload_size
      check (pg_column_size(payload) <= 262144) not valid;
  end if;
end $$;

create index if not exists shared_portfolios_created_at_idx on public.shared_portfolios (created_at desc);
create index if not exists shared_portfolios_creator_ip_idx on public.shared_portfolios (creator_ip, created_at desc);

drop policy if exists "shared portfolios insertable" on public.shared_portfolios;

insert into public.schema_migrations (version) values ('0031_shared_portfolios_hardening')
on conflict (version) do nothing;
