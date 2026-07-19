-- MONETIZATION.md Phase 3: owner-entered display prices for the /pricing
-- marketing page. Like `price_monthly`/`price_yearly` (the Stripe price
-- ids), these are config-in-DB, never env vars or hardcoded amounts, so the
-- owner can change what visitors see without a redeploy. Free-text (not a
-- number type) since the owner types the full localized string themselves,
-- e.g. "4,99 EUR" -- the app never formats or computes with it, only
-- displays it verbatim. Nullable: the pricing page shows the plan
-- comparison without an amount rather than inventing one while empty.
-- Idempotent.

alter table public.billing_config add column if not exists price_monthly_display text;
alter table public.billing_config add column if not exists price_yearly_display text;

insert into public.schema_migrations (version) values ('0070_billing_display_prices')
on conflict (version) do nothing;
