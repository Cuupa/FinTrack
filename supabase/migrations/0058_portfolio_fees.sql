-- Per-portfolio broker fee model (settings "Broker & fees"): a flat order
-- fee, an optional order-volume threshold above which it's waived, and a
-- separate savings-plan execution fee. All three only ever PREFILL a new
-- transaction/savings-plan booking's fee input (lib/finance/fees.ts), never
-- forced, always user-editable.
alter table public.portfolios add column if not exists fee_order_flat numeric not null default 0;
alter table public.portfolios add column if not exists fee_order_free_from numeric;
alter table public.portfolios add column if not exists fee_savings_plan numeric not null default 0;

insert into public.schema_migrations (version) values ('0058_portfolio_fees')
on conflict (version) do nothing;
