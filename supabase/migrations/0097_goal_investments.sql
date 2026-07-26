-- Goals can track the DEPOT, not just an account balance (owner request
-- 2026-07-25): "my portfolio should reach X". A depot value is derived from
-- the transaction log plus live prices, so there is no row to link to the way
-- an account balance is linked — hence a boolean plus an optional broker.
--
-- `linked_portfolio_id` null while `tracks_investments` is true means "every
-- portfolio combined", which is also where a goal lands if its broker is
-- deleted (on delete set null): the goal keeps working against the whole
-- depot instead of vanishing.

alter table public.goals
  add column if not exists tracks_investments boolean not null default false;

alter table public.goals
  add column if not exists linked_portfolio_id uuid
    references public.portfolios (id) on delete set null;

create index if not exists goals_linked_portfolio_id_idx
  on public.goals (linked_portfolio_id);
