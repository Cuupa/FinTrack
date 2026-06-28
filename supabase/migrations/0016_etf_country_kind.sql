-- Migration: allow 'country' in etf_breakdowns.kind so the per-country fund
-- look-through ("Distribution by Country") can be cached. Idempotent.

alter table public.etf_breakdowns drop constraint if exists etf_breakdowns_kind_check;
alter table public.etf_breakdowns
  add constraint etf_breakdowns_kind_check check (kind in ('sector', 'region', 'country'));

insert into public.schema_migrations (version) values ('0016_etf_country_kind')
on conflict (version) do nothing;
