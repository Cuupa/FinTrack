-- Missing indexes for FK/cascade-delete paths and a cron batch scan. Without
-- these, the listed queries fall back to sequential scans as the tables grow.

-- Every transaction delete cascades onto imported_rows via transaction_id;
-- unindexed, that cascade scans the whole table. Nullable (older rows
-- predate migration 0028), a plain btree index is fine.
create index if not exists imported_rows_transaction_id_idx
  on public.imported_rows (transaction_id);

-- Cascade path from assets deletes.
create index if not exists savings_plans_asset_id_idx
  on public.savings_plans (asset_id);

-- Cascade path from portfolios deletes.
create index if not exists savings_plans_portfolio_id_idx
  on public.savings_plans (portfolio_id);

-- FK integrity checks against instruments.
create index if not exists watchlist_items_instrument_id_idx
  on public.watchlist_items (instrument_id);

-- Cascade path from feature_flags deletes; the primary key (user_id, flag)
-- does not cover flag-leading lookups.
create index if not exists user_feature_flags_flag_idx
  on public.user_feature_flags (flag);

-- Matches the names-sync cron's batch scan (order by name_synced_at asc
-- nulls first, limited), see app/api/cron/sync/names/route.ts.
create index if not exists instruments_name_synced_at_idx
  on public.instruments (name_synced_at asc nulls first);

insert into public.schema_migrations (version) values ('0045_fk_indexes')
on conflict (version) do nothing;
