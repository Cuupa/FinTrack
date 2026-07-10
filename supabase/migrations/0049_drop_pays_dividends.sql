-- pays_dividends (0048) is reverted: gating dividend fetching by a catalog
-- column was the wrong fix. The real defect was dividendsByQuery scanning
-- past the hinted listing's own (possibly empty) event list, which could
-- surface an unrelated payer's events as phantom dividends - now fixed at
-- the source by trusting the hinted listing's real events, empty or not.
-- This drops the column where 0048 already ran; a no-op elsewhere.
alter table public.instruments drop column if exists pays_dividends;

insert into public.schema_migrations (version) values ('0049_drop_pays_dividends')
on conflict (version) do nothing;
