-- Best-effort DB-backed per-IP rate limiting for the market-data API proxies.
-- Fixed-window counters keyed by "route:ip:window"; an atomic upsert function
-- returns the running count so a serverless instance (no shared memory) can
-- still enforce a limit. Only the service-role client (secret key) calls the
-- function; RLS denies everyone else.

create table if not exists public.rate_limit_counters (
  bucket text primary key,
  count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_counters_created_at_idx
  on public.rate_limit_counters (created_at);
alter table public.rate_limit_counters enable row level security;

create or replace function public.rate_limit_hit(p_bucket text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c int;
begin
  insert into public.rate_limit_counters (bucket, count) values (p_bucket, 1)
  on conflict (bucket) do update set count = public.rate_limit_counters.count + 1
  returning count into c;
  if random() < 0.02 then
    delete from public.rate_limit_counters where created_at < now() - interval '1 hour';
  end if;
  return c;
end;
$$;

insert into public.schema_migrations (version) values ('0043_rate_limit')
on conflict (version) do nothing;
