-- Dividend fetching is gated per instrument by the catalog, not by asset
-- type in code. Even with a correctly resolved gold quote_id, /api/dividends'
-- name-fallback search ("Gold") could still find an unrelated payer and
-- surface its events as phantom XAU dividends - the fix is reference data
-- (pays_dividends), not a type allow-list.
alter table public.instruments add column if not exists pays_dividends boolean not null default true;

-- Backfill existing rows: no crypto/commodity/cash instrument pays a
-- dividend. Idempotent, converges on rerun.
update public.instruments
set pays_dividends = false
where type in ('CRYPTO', 'COMMODITY', 'CASH') and pays_dividends;

insert into public.schema_migrations (version) values ('0048_instrument_pays_dividends')
on conflict (version) do nothing;
