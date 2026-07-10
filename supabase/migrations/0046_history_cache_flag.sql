-- Feature flag for the client-side stale-while-revalidate cache of
-- /api/history responses (seeded enabled, same pattern as 0035/0039). No new
-- tables - the cache itself lives in the browser's localStorage.
insert into public.feature_flags (flag, description) values
  ('historyCache', 'Client-side stale-while-revalidate cache of historical price series (instant chart repaint on repeat visits)')
on conflict (flag) do nothing;

insert into public.schema_migrations (version) values ('0046_history_cache_flag')
on conflict (version) do nothing;
