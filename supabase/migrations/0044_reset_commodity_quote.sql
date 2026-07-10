-- Heals the deployed gold (XAU) row: the price-sync cron previously
-- re-resolved the ambiguous bare-ticker query "XAU" via Yahoo search (no
-- hint fast-path guard existed yet for COMMODITY rows), learned a wrong
-- listing (~44 EUR/gram line) that overwrote the seeded quote_id
-- XAUEUR=X, and then applied quote_scale (~0.0321507466, a per-troy-ounce
-- -> per-gram conversion) on top of it, landing at ~1.42 EUR. The seeded
-- listing (schema.sql's Gold seed) is authoritative for COMMODITY rows -
-- app/api/cron/sync/prices/route.ts now guards against this by never
-- letting a COMMODITY row's hinted listing be overwritten by search.
--
-- Resets the mis-resolved row back to the seeded listing and clears the
-- stale price so no wrong value survives until the next cron run - a null
-- last_price is already a normal, tolerated state (every read site checks
-- `!= null` and falls back to synthetic pricing / a one-shot fetch).
update public.instruments
set quote_source = 'yahoo',
    quote_id = 'XAUEUR=X',
    last_price = null
where symbol = 'XAU'
  and type = 'COMMODITY'
  and (quote_id is distinct from 'XAUEUR=X' or quote_source is distinct from 'yahoo');

insert into public.schema_migrations (version) values ('0044_reset_commodity_quote')
on conflict (version) do nothing;
