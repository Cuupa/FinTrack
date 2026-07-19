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
- [ ] B1. /api/admin/billing: GET returns billing_config (prices, enabled) + { secretKeySet, webhookSecretSet }; POST kinds for config (prices/enabled upsert) and keys (set or clear; empty = clear); requireAdmin + audit (redacted for keys)
- [ ] B2. New /admin/billing page + nav item: Stripe keys card (password inputs, configured yes/no as plain text, save/clear) and selling card (price id inputs, enabled toggle)
- [ ] B3. Skeleton loading while the GET is in flight; no badges; no em-dashes; en/de/es keys (du/tú), es parity test green
- [ ] B4. CLAUDE.md billing paragraph updated (keys DB-first with env fallback, /admin/billing)

## Cross-cutting
- [ ] C1. Full suite + lint + tsc green; production build passes
- [ ] C2. One commit per task, no branches
- [~] C3. Prod verification (enter real keys on /admin/billing, run a checkout) needs the owner's Stripe account - deferred to owner
