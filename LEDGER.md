# Ledger - round 2026-07-19b (billing config + Stripe keys editable in /admin)

Previous round 2026-07-19 closed and preserved in git history (dbbe9f6).

User request: "make key secret etc in admin accessible" (selection: migration
0066). Meaning: Stripe secret key, webhook secret, price ids and the selling
toggle become owner-editable in the admin UI at runtime, no redeploy.

Architecture decisions (orchestrator):
- Secrets NEVER go into `billing_config` (world-readable). They live in
  `app_settings` (single row id=1, RLS enabled, zero policies: unreadable even
  with the publishable key; only admin routes via service role touch it).
- Runtime resolution: DB value wins when set, env var (STRIPE_SECRET_KEY /
  STRIPE_WEBHOOK_SECRET) stays as fallback so existing deploys keep working.
- Admin GET never echoes a stored secret: presence booleans only.
- Audit rows for key writes record set/cleared only, never the value.

## Task A - schema + server resolution (Sonnet)
- [x] A1. Migration 0067: `app_settings` gains `stripe_secret_key text`, `stripe_webhook_secret text` (nullable), idempotent; schema.sql mirrored
- [x] A2. lib/server key resolver: reads app_settings via service role, falls back to env; used by checkout, portal, webhook, cron reconcile
- [x] A3. Bulk /api/cron/sync no longer gates the billing sub-sync on the env var only (sub-sync skips cleanly when no key resolves at all)
- [x] A4. Webhook 503-unconfigured behavior preserved when neither DB nor env has a webhook secret
- [x] A5. Tests: resolver precedence (DB wins, env fallback, neither -> null) with the DB read behind a small injectable function, no supabase-js chain mocks

## Task B - admin API + /admin/billing page (Sonnet)
- [x] B1. /api/admin/billing: GET returns billing_config (prices, enabled) + { secretKeySet, webhookSecretSet }; POST kinds for config (prices/enabled upsert) and keys (set or clear; empty = clear); requireAdmin + audit (redacted for keys)
- [x] B2. New /admin/billing page + nav item: Stripe keys card (password inputs, configured yes/no as plain text, save/clear) and selling card (price id inputs, enabled toggle)
- [x] B3. Skeleton loading while the GET is in flight; no badges; no em-dashes; en/de/es keys (du/tú), es parity test green
- [x] B4. CLAUDE.md billing paragraph updated (keys DB-first with env fallback, /admin/billing)

Note: admin routes in this codebase don't unit-test their Supabase-dependent
branches (see tests/require-admin.test.ts's own comment on the convention).
Followed the same pattern lib/server/billing-keys.ts set for `resolveStripeKey`:
extracted the pure validation/normalization/redaction logic into
`lib/server/billing-admin.ts` (`parseBillingConfigBody`, `parseBillingKeysBody`,
`redactKeysForAudit`) and unit-tested that (`tests/billing-admin.test.ts`, 17
cases) instead of mocking supabase-js. Browser-verified in Guest Mode: `/admin/billing`
redirects to `/` (no Supabase -> not admin, expected, no console errors) and
`GET /api/admin/billing` returns 401 with no bearer token / 503 "admin not
configured" with one, both matching every other admin route's unconfigured
behavior. Could not verify the page's actual rendering (inputs, skeleton,
save/remove flows) since local dev has no Supabase config to pass requireAdmin
- needs an owner check against prod with a real admin session, same caveat as
C3 below.

## Cross-cutting
- [x] C1. Full suite + lint + tsc green; production build passes (verified after Task B: 633 passed/4 skipped, lint clean, tsc clean, `npm run build` succeeded with /admin/billing + /api/admin/billing in the route list)
- [x] C2. One commit per task, no branches (d397c9c key resolution, admin page follows)
- [~] C3. Prod verification (enter real keys on /admin/billing, run a checkout) needs the owner's Stripe account - deferred to owner
