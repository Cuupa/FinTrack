-- Adds a COMMODITY instrument type, a per-instrument quote_scale unit factor
-- (multiplier applied to a resolved market price to convert provider units
-- into the instrument's native display units), and seeds Gold (XAU, priced
-- in EUR per gram from a per-troy-ounce Yahoo quote XAUEUR=X, scaled by
-- 1 / 31.1034768 ~= 0.0321507466).

-- Widen the instruments.type check to allow COMMODITY.
alter table public.instruments drop constraint if exists instruments_type_check;
alter table public.instruments
  add constraint instruments_type_check check (type in ('ETF', 'STOCK', 'CRYPTO', 'CASH', 'COMMODITY'));

-- Per-instrument price scale factor (default 1 leaves existing rows unaffected).
alter table public.instruments add column if not exists quote_scale numeric not null default 1;

-- Seed the Gold instrument.
insert into public.instruments
  (symbol, name, type, currency, quote_source, quote_id, base_price, drift, vol, dividend_yield, quote_scale)
values
  ('XAU', 'Gold', 'COMMODITY', 'EUR', 'yahoo', 'XAUEUR=X', 115, 0.03, 0.16, 0, 0.0321507466)
on conflict (symbol) where symbol is not null do nothing;

insert into public.schema_migrations (version) values ('0040_commodity_type')
on conflict (version) do nothing;
