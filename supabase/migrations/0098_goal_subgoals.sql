-- Sub-goals (ROADMAP #6 follow-up): a goal can be composite -- "trip to the
-- USA" is flight + hotel + taxi -- and its target is the sum of its parts.
-- Composition is expressed by the children pointing at their parent, so an
-- atomic goal ("emergency fund") needs no extra data at all.
--
-- Nesting is one level deep by convention (a sub-goal is a line item, not
-- another project); the FK itself is self-referential and unconstrained in
-- depth, the app simply never offers a sub-goal as a parent.
--
-- on delete cascade, unlike goals.linked_account_id's set null: a goal
-- survives losing its account (it falls back to manual tracking), but a
-- sub-goal without its parent means nothing.
alter table public.goals
  add column if not exists parent_goal_id uuid references public.goals (id) on delete cascade;

create index if not exists goals_parent_goal_id_idx on public.goals (parent_goal_id);
