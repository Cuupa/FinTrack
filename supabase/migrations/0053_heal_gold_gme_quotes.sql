-- Heals two mis-resolved catalog rows, both confirmed empirically:
--
-- 1. Gold (XAU, COMMODITY): Yahoo has delisted the seeded quote_id
--    XAUEUR=X ("No data found, symbol may be delisted"), so the cron's
--    COMMODITY hint guard (app/api/cron/sync/prices/route.ts) correctly
--    refuses to re-resolve it via search and last_price stays null
--    forever, leaving the UI on the synthetic fallback (~128.91 vs the
--    real ~116 EUR/g). The working replacement is GC=F (COMEX gold
--    futures, quoted per troy ounce in USD): the cron FX-converts
--    USD->EUR and then applies the existing quote_scale
--    (0.0321507466, per-ounce -> per-gram) exactly as before, so
--    nothing else about the row changes.
--
-- 2. GameStop (GME, STOCK, symbol-only, no ISIN): the stored quote_id
--    GMEX resolves on Yahoo to "GMEX Robotics Corporation" (Nasdaq
--    Capital Market), an unrelated company, not GameStop - its adjusted
--    history shows a ~7435 USD spike on 2025-07-25 that leaked into the
--    user's GME price chart. The correct listing is GME (NYSE
--    GameStop).
--
-- Both updates are guarded to the known-bad quote_id values only, so
-- this never clobbers a future manual fix or re-resolution.
update public.instruments
set quote_id = 'GC=F',
    last_price = null
where symbol = 'XAU'
  and type = 'COMMODITY'
  and quote_id = 'XAUEUR=X';

update public.instruments
set quote_id = 'GME',
    last_price = null
where symbol = 'GME'
  and type = 'STOCK'
  and quote_id = 'GMEX';

-- Purge the poisoned cached history series written from the dead/wrong
-- listings above - /api/history refetches on demand from the healed
-- quote_id.
delete from public.instrument_history where price_key in ('XAU', 'GME');

insert into public.schema_migrations (version) values ('0053_heal_gold_gme_quotes')
on conflict (version) do nothing;
