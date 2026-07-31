-- Pinned quote listings: stop the daily self-heal from destroying a curated
-- one (no flag, affects every instrument).
--
-- One ISIN has listings in several currencies, and for VWCE the seed pins the
-- EUR Xetra line (VWCE.DE) precisely because the USD London line (VWRA.L) is
-- the wrong one to price a EUR holding with. But STOCK/ETF rows "self-heal"
-- once a day: the cron drops the stored hint and re-resolves from scratch so a
-- genuinely stuck quote_id can recover (the GME case). Yahoo's search for
-- IE00BK5BQT80 does not return VWCE.DE at all, so the wanted-currency filter
-- had nothing to match, the whole candidate tier survived, and the highest
-- exchange score -- VWRA.L, USD -- won and was written back over the seed.
--
-- The cached price stayed roughly right (the cron FX-converts USD->EUR), but
-- every surface that shows the NATIVE price then showed ~188.80, a number the
-- user has never seen on their broker statement, instead of the ~164.06 Xetra
-- quote. Reported twice; this is the fix.
--
-- Currency alone cannot tell a good hint from a bad one: GME's wrong listing
-- (GME.F, Geratherm Medical) was ALSO in the instrument's currency, which is
-- why "keep the hint whose currency matches" would have silently re-broken
-- that case. What actually separates the two is provenance: VWCE.DE was
-- curated by hand in the seed, GME.F was learned by search. So the seed says
-- so explicitly, and self-healing keeps working for everything it was built
-- for.
--
-- This generalises the rule COMMODITY rows already had (their seeded quote_id
-- is authoritative and never re-resolved) from one asset type to "any listing
-- the owner pinned".
alter table public.instruments
  add column if not exists quote_pinned boolean not null default false;

comment on column public.instruments.quote_pinned is
  'Owner-curated quote listing: the price cron reuses quote_id verbatim and never re-resolves or overwrites it. Set for hand-seeded listings where an ISIN has listings in several currencies.';

-- Pin the hand-curated listings from the seed. Matched by ISIN/symbol rather
-- than by the current quote_id, since the drift this migration repairs means
-- the stored quote_id is exactly what must NOT be matched on.
update public.instruments set quote_pinned = true
  where isin in ('IE00BK5BQT80', 'IE00B4L5Y983')
     or symbol in ('AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA', 'SPY');

-- COMMODITY rows were already authoritative in code; make that visible in the
-- data too, so the two rules are one rule.
update public.instruments set quote_pinned = true
  where type = 'COMMODITY' and quote_id is not null;

-- Repair the rows the self-heal already overwrote, back to the seeded listing.
-- Guarded on the ISIN so a row that is already correct is untouched.
--
-- last_price is deliberately LEFT ALONE. It is currently the USD line's price
-- FX-converted back to EUR (164.48 against the true Xetra 164.06 -- the ~0.3%
-- the wrong listing costs), so it is close enough to keep showing until the
-- next sync overwrites it from VWCE.DE. Nulling it would drop the row to the
-- on-demand /api/price path, or to the synthetic price if that also fails, for
-- no gain: the cron re-syncs every row on every run and never skips a
-- recently-synced one.
update public.instruments
  set quote_source = 'yahoo', quote_id = 'VWCE.DE'
  where isin = 'IE00BK5BQT80' and quote_id is distinct from 'VWCE.DE';

update public.instruments
  set quote_source = 'yahoo', quote_id = 'IWDA.AS'
  where isin = 'IE00B4L5Y983' and quote_id is distinct from 'IWDA.AS';

insert into public.schema_migrations (version) values ('0107_pinned_quote_listings')
on conflict (version) do nothing;
