-- Real household ownership for accounts and portfolios (brokers).
--
-- Until now every financial row was owned by exactly one member (user_id), and
-- "ownership" was only ever a display label since RLS already shares every
-- peer's rows across the household. There was no way to say "this is a joint
-- account / a shared depot" and no way to reassign one after the fact.
--
-- `household_id` makes the household itself an owner: a row with it set belongs
-- to the household (shown as "Gemeinsam"), not to any single member. user_id
-- stays NOT NULL as the creator / cascade anchor; `on delete set null` on the
-- household FK reverts a row to individual ownership if the household dissolves.
--
-- Reassignment is two moves the store performs:
--   * to a member   -> set user_id = <member>, household_id = null
--   * to the household -> set household_id = my_household_id() (user_id kept)

alter table public.accounts
  add column if not exists household_id uuid references public.households (id) on delete set null;
alter table public.portfolios
  add column if not exists household_id uuid references public.households (id) on delete set null;

create index if not exists accounts_household_id_idx on public.accounts (household_id);
create index if not exists portfolios_household_id_idx on public.portfolios (household_id);

-- RLS: a member may also reach a row owned by their own household -- but ONLY
-- while sharing is actually active, so a joint row created by a peer does not
-- leak once the household drops back to free (household_peer_ids() already
-- collapses to self then, so the user_id clause alone would hide it; the
-- household_id clause must respect the same gate or it would re-expose it).
drop policy if exists "own accounts" on public.accounts;
create policy "own accounts" on public.accounts
  for all using (
    auth.uid() = user_id
    or user_id in (select public.household_peer_ids())
    or (household_id = public.my_household_id() and public.household_sharing_active())
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.household_peer_ids())
    or (household_id = public.my_household_id() and public.household_sharing_active())
  );

drop policy if exists "own portfolios" on public.portfolios;
create policy "own portfolios" on public.portfolios
  for all using (
    auth.uid() = user_id
    or user_id in (select public.household_peer_ids())
    or (household_id = public.my_household_id() and public.household_sharing_active())
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.household_peer_ids())
    or (household_id = public.my_household_id() and public.household_sharing_active())
  );
