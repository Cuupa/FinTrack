# Operations runbook

This is an ops runbook for whoever operates a self-hosted FinTrack
deployment: deploys, database migrations, cron jobs, backups, key rotation
and incident triage. For local setup and environment variables, see
`README.md`; for architecture and code conventions, see `CLAUDE.md`. This
file does not duplicate either, it only adds what an operator needs once the
app is running in production.

## 1. Deploy & rollback

Production deploys are Vercel builds triggered on push to `main`. Vercel
runs `npm run build` (`vitest run` followed by `next build`, see
`package.json`), so a push that fails tests or the production build never
reaches a live deployment.

**Rollback**:

- **Fast path (no code change needed)**: in the Vercel dashboard, open the
  project's Deployments list and "Promote to Production" (instant rollback)
  a previous, known-good deployment. This does not touch the database, so it
  is safe as long as the rollback target's schema expectations are still
  satisfied by the current database state (see the migration notes below
  before rolling back across a migration boundary).
- **Code-level rollback**: `git revert` the offending commit(s) on `main` and
  push, so the fix is captured in history rather than only in Vercel's
  deployment list. Prefer this when the previous deployment is more than a
  commit or two behind, or when a database migration shipped alongside the
  bad code (see the note below).

Rolling back past a commit that added a `supabase/migrations/*.sql` file is
safe for the code side, but the migration itself is not automatically
undone: migrations only ever add tables/columns/indexes/policies, never drop
data, so an older deployment simply ignores columns/tables it doesn't know
about. There is no down-migration tooling in this repo, if you need to
actually undo a schema change, write and apply a new forward migration that
reverses it.

## 2. Database migrations

- **Fresh install**: run `supabase/schema.sql` once against a new Supabase
  project. It creates every table, index, RLS policy and seed row
  (`instruments`, `feature_flags`, the migration history itself) in one
  idempotent pass.
- **Existing database**: apply the files under `supabase/migrations/` in
  filename order (they are numbered, e.g. `0051_error_logs.sql`,
  `0052_retention_indexes.sql`). Every statement in every migration is
  idempotent (`create table if not exists`, `add column if not exists`,
  `drop policy if exists` before `create policy`, guarded backfills via
  `do $$ ... $$` blocks), so re-running an already-applied migration is a
  safe no-op.
- **What has already been applied**: query the `schema_migrations` table:

  ```sql
  select version from public.schema_migrations order by version;
  ```

  Each migration file inserts its own version string into this table at the
  end (`insert into public.schema_migrations (version) values ('0052_...')
  on conflict (version) do nothing;`). If a version present in
  `supabase/migrations/` is missing from this table, that migration has not
  been applied yet; apply it and every migration after it, in order.
- There is no automated migration runner in this repo. Apply migration files
  by hand (Supabase SQL editor, `psql`, or any Postgres client) against the
  project's connection string.

## 3. Cron jobs

All cron endpoints live under `app/api/cron/sync/`, are `POST`-only, and
require `Authorization: Bearer $CRON_SECRET` whenever `CRON_SECRET` is set
(enforced once, at the edge, by `middleware.ts`, before the request reaches
any route). If `CRON_SECRET` is unset, the routes run open, fine for local
development, not for a public deployment.

Point any scheduler capable of an authenticated HTTP POST at these
(Vercel Cron, a GitHub Actions scheduled workflow, or any other
cron-capable host; the app itself never calls them):

| Endpoint | What it refreshes |
| --- | --- |
| `POST /api/cron/sync` | Bulk orchestrator: calls every sub-sync below in sequence, `prices`, `constituents`, `classifications`, `names`, `etf-breakdowns`, `benchmarks`, `shared-portfolios`, `error-logs`, `retention`. Slow (`maxDuration = 300`); if it times out on your host, call the sub-routes individually instead. |
| `POST /api/cron/sync/prices` | Live equity/crypto prices + FX into `instruments`/`fx_rates`. Add `?revalidate=1` to force the daily self-heal early (see the price self-heal note in section 6) instead of waiting for the 03:00 UTC hour. The bulk orchestrator forwards its own query string only to this sub-sync. |
| `POST /api/cron/sync/constituents` | Re-fetches ETF holdings for catalog funds with a fetchable source. |
| `POST /api/cron/sync/classifications` | Backfills sector/region for ETF constituents and directly-held stocks, in capped batches; re-run until the response's `remaining` is 0. |
| `POST /api/cron/sync/names` | Re-resolves official instrument names for the catalog, in capped batches (skips CASH and COMMODITY, see `CLAUDE.md`). |
| `POST /api/cron/sync/etf-breakdowns` | Caches sector/region/country weightings per ETF for the Analysis pies. |
| `POST /api/cron/sync/benchmarks` | Force-refreshes cached benchmark history. |
| `POST /api/cron/sync/shared-portfolios` | Deletes expired `shared_portfolios` rows (best-effort storage reclaim; RLS already hides expired shares, so this isn't correctness-critical). |
| `POST /api/cron/sync/error-logs` | Purges `error_logs` rows older than 30 days. |
| `POST /api/cron/sync/retention` | Purges `simulation_runs` rows older than 90 days and `instrument_history` rows older than 60 days (both pure caches, safe to prune). |

Example, using the bulk orchestrator with the daily price self-heal forced:

```bash
curl -X POST "https://your-deployment.example/api/cron/sync?revalidate=1" \
  -H "Authorization: Bearer $CRON_SECRET"
```

A reasonable production schedule is once every 1-4 hours for the bulk
orchestrator (prices are the time-sensitive part); `classifications` and
`names` are cheap to run more rarely since they self-track remaining work
via staleness markers instead of reprocessing everything each time.

## 4. Backups & PITR

FinTrack itself ships no backup tooling, all durable state for Registered
Mode lives in the Supabase Postgres database, so backups are a Supabase
project setting, not an app setting.

- **Point-in-time recovery (PITR)**: available on Supabase's paid plans.
  Recommended for any production deployment with real user data, since it
  lets you restore to any point within the retention window rather than only
  to the last scheduled snapshot. Enable and configure it from the Supabase
  project dashboard under Database settings.
- **Without PITR**: schedule periodic logical dumps with `pg_dump`, using
  the connection string shown in the Supabase dashboard (Project Settings ->
  Database). Store dumps somewhere outside the Supabase project itself
  (separate object storage, a backup host) so a project-level incident
  doesn't take out the backups too.
- **What to back up**: the whole schema, every table under `public` created
  by `supabase/schema.sql`. There is no partial/selective backup need, the
  tables are small relative to typical Postgres workloads.
- **What is deliberately NOT backed up server-side**: Guest Mode data
  (`localStorage`, browser-only by design) and the tag groups/assignments
  feature (`fintrack-tags`, also `localStorage`-only, see `CLAUDE.md`). Both
  live entirely on the user's device; losing the device or clearing browser
  storage loses that data, this is documented user-facing behavior
  (`/datenschutz`), not a gap to fix operationally.

## 5. Key rotation

Secrets, per `.env.example`:

| Secret | Where it's rotated | User-visible impact |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Only changes if you migrate to a different Supabase project. | Full outage until redeployed with the new value. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard, Project Settings -> API. | Rotating the anon/publishable key invalidates active browser sessions built against the old key; users are signed out and must sign in again. |
| `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard, Project Settings -> API. Server-only, never exposed to the browser. | No direct user-visible impact (it isn't used for auth sessions), but every cron/admin route that needs it returns 500 ("secret key not configured") until the new value is deployed. |
| `CRON_SECRET` | Generate a new random value yourself; there is no dashboard for this one, it's an app-level convention checked in `middleware.ts`. | None for end users; any scheduler still using the old value gets 401s from `/api/cron/*` until updated. |
| `FMP_API_KEY` (optional) | Financial Modeling Prep dashboard, if configured at all. | None; only affects ETF-constituents coverage beyond SlickCharts-covered indices. |
| OAuth provider secrets (Google, GitHub) | Rotated in each provider's developer console, then re-entered in the Supabase dashboard under Authentication -> Providers, not in this app's env vars at all. | Users mid-OAuth-flow at the moment of rotation may see a failed sign-in and need to retry; already-established sessions are unaffected. |

Rotation procedure for any of the above: rotate the value at its source
(Supabase dashboard, provider console, or generate a new random string for
`CRON_SECRET`), update the corresponding environment variable in the Vercel
project settings, then redeploy (a Vercel env var change does not
automatically restart a running deployment). Update any external scheduler
config that carries `CRON_SECRET` in the same pass, or every cron call
starts failing with 401 until you do.

## 6. Incident basics

- **Application errors**: `/admin/errors` lists everything reported by the
  client-side error boundaries and the window-level error listener (no PII
  stored, see `lib/errors/report.ts` / `app/api/errors/route.ts`), newest
  first, filterable by kind/date/free text, capped at 500 rows. Rows older
  than 30 days are pruned automatically by the `error-logs` cron (section
  3). Use "Purge all" / "Purge older than 7 days" if the table needs a
  manual reset, both are confirmed via the app's `ConfirmDialog`.
- **Price anomalies**: `/admin/prices` shows every catalog instrument with a
  staleness badge (fresh/stale/dead/unknown, from `lib/admin/price-health.ts`)
  and a per-row "Revalidate" action, plus a bulk "Revalidate all". Two
  different self-heal rules apply, and mixing them up leads to the wrong
  diagnosis:
  - **STOCK/ETF** rows self-heal: once a day (the 03:00 UTC cron hour) or on
    any call with `?revalidate=1`, the stored quote hint is dropped and
    re-resolved from scratch. If a STOCK/ETF price looks wrong, hitting
    "Revalidate" (or waiting for the next 03:00 UTC run) is usually enough.
  - **COMMODITY** rows never self-heal: the stored `quote_id` is treated as
    authoritative and is never re-resolved via search, because a bare metal
    ticker search can mis-resolve (this once priced gold at 1.42 EUR by
    matching the wrong instrument). If a COMMODITY price looks wrong, the
    fix is a manual catalog correction (fix `instruments.quote_id` directly),
    not a revalidate click.
- **Yahoo rate limiting**: all Yahoo traffic goes through the shared
  `getJSON` helper in `lib/server/yahoo.ts`, which has a concurrency
  semaphore, exponential backoff with jitter on 429/503, and a circuit
  breaker that short-circuits further Yahoo calls for a cooldown period once
  retries are exhausted. When Yahoo is degraded, equities fall back to
  Stooq, then to the deterministic synthetic price series (surfaced in the
  UI via the `EstimatedBadge`) so the app stays usable, just with the
  estimated-data caveat visible. No action is usually needed, this is
  designed to self-recover once Yahoo's rate limit window passes.
- **API rate limits**: the market-data proxy routes are rate-limited per IP
  via a Postgres-backed counter (`lib/server/rate-limit.ts`). This fails
  open (allows the request) whenever Supabase is not configured or the
  client IP can't be determined, so a no-Supabase or Guest-Mode-only
  deployment is never blocked by this mechanism, and a Supabase outage
  degrades to "no rate limiting" rather than "everything 429s".

## 7. Admin access

`/admin/*` is gated by an explicit allowlist table, `public.admins`
(migration `0050_admin_authz.sql`), not a role or claim. There is no seed
row by design, grant the first admin manually after deploy:

```sql
insert into public.admins (user_id)
select id from auth.users where email = '<login email>';
```

Once a user's `auth.users.id` is in `public.admins`, they see the admin
shell (gated client-side by the `useIsAdmin` hook, enforced server-side by
`requireAdmin` on every mutating admin route) with six sections:

- **Overview** (`/admin`): four health tiles (instruments needing
  attention, flags, error volume last 24h/7d, site-config completeness),
  each linking to its detail section.
- **Flags** (`/admin/flags`): global `feature_flags` defaults and
  per-user `user_feature_flags` overrides.
- **Site** (`/admin/site`): operator-identity fields shown on the legal
  pages, plus the registration cap (`app_settings.max_users`).
- **Prices** (`/admin/prices`): the price-health table and revalidate
  actions described in section 6.
- **Errors** (`/admin/errors`): the error-log viewer described in
  section 6.
- **Audit** (`/admin/audit`): read-only trail of every admin mutation
  (flag changes, site-config edits, price revalidations, error purges),
  each recorded by `lib/server/require-admin.ts`'s `audit()` helper at the
  point of the mutation itself.
