-- Two additions that share nothing but this file: credit interest on asset
-- accounts, and goals for a single depot position.
--
-- 1) accounts.interest_frequency
--    `interest_rate` used to mean one thing only: what a LIABILITY costs
--    (ROADMAP #9's payoff planner). A savings account earns interest the same
--    way, so the column now serves both directions -- on an asset account it
--    is the credit interest the bank pays, and entering it IS the opt-in
--    (an asset account never carried a rate for anything else).
--    A bank credits that interest monthly, quarterly or annually, hence the
--    frequency column. Null = monthly, which is exactly what liability
--    accrual (`balanceSeries` in lib/finance/accounts.ts) always did, so an
--    unmigrated row keeps behaving identically.
--
-- 2) goals.linked_asset_id
--    A depot goal could cover the whole depot or one broker's; it could not
--    say "the ETF should be worth 10k" or "Meta should be worth 2k". The
--    column narrows a `tracks_investments` goal to a single position, across
--    every broker (the same ETF held at two brokers is one position).
--    `on delete set null` mirrors linked_account_id/linked_portfolio_id: the
--    goal survives its asset and falls back to the whole depot rather than
--    disappearing with it.
--
-- Both columns are additive and nullable, so nothing in prod changes until a
-- user fills them in.

alter table public.accounts
  add column if not exists interest_frequency text;
alter table public.accounts
  drop constraint if exists accounts_interest_frequency_check;
alter table public.accounts
  add constraint accounts_interest_frequency_check check (
    interest_frequency is null
    or interest_frequency in ('MONTHLY', 'QUARTERLY', 'ANNUAL')
  );

alter table public.goals
  add column if not exists linked_asset_id uuid
  references public.assets (id) on delete set null;
create index if not exists goals_linked_asset_id_idx
  on public.goals (linked_asset_id);
