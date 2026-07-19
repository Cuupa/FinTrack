# Ledger - round 2026-07-19 (MONETIZATION.md Phase 1: Stripe billing)

Previous round 2026-07-18d closed and preserved in git history (6814630).

Scope: Phase 1 of MONETIZATION.md (billing schema + webhook + checkout/portal
routes + settings card, all behind a `billing` feature flag seeded OFF).
Phase 2 (plan gating) is already dark-launched (migration 0065). Phases 3/4
stay untouched: they need owner sign-off on section-7 decisions (pricing,
tier flips, legal copy, live Stripe keys).

## Task A - billing schema (Sonnet)
- [x] A1. Migration 0066_billing.sql: `billing_customers`, `subscriptions`, `stripe_events`, `billing_config` per MONETIZATION.md section 3, idempotent (reviewed line by line against the design)
- [x] A2. RLS: select-own on billing_customers/subscriptions, no client write policies; stripe_events no client policies; billing_config world-readable
- [x] A3. `billing_config` single row (id=1: price_monthly, price_yearly, enabled default false), seeded empty/disabled
- [x] A4. `billing` feature flag row seeded `enabled=false` (off in prod until webhooks verified)
- [x] A5. schema.sql mirrored in the same change (standing rule)
- [x] A6. .env.example gains STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (on disk only: .env* is gitignored, so this cannot be committed)

## Task B - Stripe server layer (Opus)
- [ ] B1. No new npm dependency: raw Stripe REST via fetch (form-encoded), server-side only - matches the repo's Yahoo/Frankfurter convention and keeps CSP untouched
- [ ] B2. Webhook signature verification as a pure function: HMAC-SHA256 over `${t}.${raw body}`, timing-safe compare, timestamp tolerance
- [ ] B3. `/api/billing/webhook`: raw body first, idempotency insert into stripe_events (conflict -> 200), events funneled into one `upsertSubscription`; unhandled types 200, handler errors 500
- [ ] B4. Event mapping pure + unit-tested with fixture payloads: checkout.session.completed, customer.subscription.created/updated/deleted; mapping via client_reference_id / stripe_customer_id, never email
- [ ] B5. `/api/billing/checkout` (POST): session bearer auth (account-delete pattern), rate-limited, price from billing_config, customer reused from billing_customers or created+persisted, client_reference_id=user id, success/cancel URLs to /settings, automatic_tax + allow_promotion_codes; refuses when billing_config disabled
- [ ] B6. `/api/billing/portal` (POST): session bearer auth, rate-limited, portal session for the user's customer id
- [ ] B7. `/api/cron/sync/billing`: reconcile non-free local rows against Stripe (missed-webhook repair), CRON_SECRET check like other sub-syncs, wired into bulk /api/cron/sync
- [ ] B8. stripe_events pruned after 30 days in the retention sub-sync
- [ ] B9. Tests: unsigned webhook rejected, signature verify pos/neg, event->upsert mapping, no supabase-js chain mocks (extract pure parts)

## Task C - client wiring + settings card (Sonnet)
- [ ] C1. BillingProvider (lib/billing) under AuthProvider: loads own subscription row once per session + on ?billing=success return; guests/no-Supabase => free
- [ ] C2. `usePlan()` becomes a context read feeding `resolvePlan` - signature unchanged, zero call-site changes
- [ ] C3. /settings "Subscription" card gated by `billing` flag: current plan, renewal/end date incl. cancel-at-period-end wording, Upgrade (monthly/yearly -> checkout redirect), Manage (portal redirect)
- [ ] C4. i18n: all new copy in en/de/es; German du-register, Spanish tú, no em-dashes, no badges of any kind; es parity test green
- [ ] C5. Skeleton loading (not placeholders) while the subscription row is in flight

## Cross-cutting
- [ ] D1. All suites + lint green; production build passes
- [ ] D2. One commit per task, short messages, no branches
- [ ] D3. CLAUDE.md billing paragraph updated (usePlan no longer hardcoded)
- [~] D4. Live verification (webhook on prod URL, Stripe test-mode matrix) needs owner's Stripe account + keys (open decision 7.6) - deferred to owner
- [~] D5. Legal updates (/datenschutz Stripe processor, /terms subscription terms) ship with Phase 3 per MONETIZATION.md section 5 - deferred with billing flag off
- [~] D6. Pricing/trial figures, tier flips, grandfathering: owner decisions (section 7), not part of Phase 1
