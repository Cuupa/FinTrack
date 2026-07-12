-- Adds two per-year manual tax entry maps to the profile: Vorabpauschale
-- (notional tax pre-payment on accumulating funds, entered from the broker's
-- annual tax statement since it can't be computed from transaction data) and
-- an override for the tax withheld by the broker (replaces the
-- transaction-derived sum when set). Both are year -> amount (base currency)
-- maps, keyed by year string ("2025"). Feeds the "Steuern" tab on /analysis
-- (lib/finance/tax.ts).
alter table public.profiles add column if not exists tax_vorabpauschale jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists tax_withheld_override jsonb not null default '{}'::jsonb;

insert into public.schema_migrations (version) values ('0055_manual_tax_entries')
on conflict (version) do nothing;
