-- A retry queue for instruments the price cron could not price.
--
-- Yahoo rate-limits, and when it does the cooldown breaker makes every
-- remaining row of that sweep come back empty. Those rows then waited for the
-- next ordinary run, which treated them exactly like the hundreds that priced
-- fine -- and since the expensive hint-less re-resolution only runs in the
-- 03 UTC hour, a row that needed it and was rate-limited out of it waited a
-- full day for its next chance.
--
-- `price_fail_count` counts CONSECUTIVE failures (a successful sync resets it
-- to 0), so it doubles as the backoff exponent; `price_failed_at` is when the
-- last sweep gave up on the row. Together they say who goes first in the next
-- sweep. Both default to "never failed", so a deploy queues nothing.

alter table public.instruments
  add column if not exists price_failed_at timestamptz;

alter table public.instruments
  add column if not exists price_fail_count integer not null default 0;

-- Partial: the queue is tiny next to the catalog, and this is the only lookup
-- pattern (the sweep reads every row anyway, the admin view wants just these).
create index if not exists instruments_price_failed_idx
  on public.instruments (price_failed_at)
  where price_failed_at is not null;
