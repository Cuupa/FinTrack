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
- [x] B1. No new npm dependency: raw Stripe REST via fetch (form-encoded), server-side only (lib/server/stripe.ts `stripeFetch`); CSP untouched
- [x] B2. Webhook signature verification pure (`verifyStripeSignature`): HMAC-SHA256 over `${t}.${raw body}`, timing-safe multi-v1 compare, 300s tolerance
- [x] B3. `/api/billing/webhook`: raw body first, idempotency CLAIM in stripe_events (23505 -> 200); claim RELEASED on processing failure before the 500 so Stripe's retry actually reprocesses (claim/release refinement of the design, flagged by subworker, approved)
- [x] B4. Event mapping pure + unit-tested (`planForEvent`/`subscriptionRowFrom`, both period-end locations); user mapped only via client_reference_id / billing_customers, never email; subscription event racing ahead of the mapping -> 500 so the retry lands after checkout.session.completed
- [x] B5. `/api/billing/checkout` (POST): session bearer auth, rate-limited, price from billing_config (403 disabled, 503 unconfigured), customer reuse-or-create+persist, client_reference_id, success/cancel URLs to /settings, automatic_tax + allow_promotion_codes
- [x] B6. `/api/billing/portal` (POST): session bearer auth, rate-limited, 404 without a billing_customers row
- [x] B7. `/api/cron/sync/billing`: reconcile against Stripe (404 resource_missing -> canceled), CRON_SECRET check, wired into bulk /api/cron/sync behind STRIPE_SECRET_KEY, skips cleanly on Stripe-less deploys
- [x] B8. stripe_events pruned after 30 days in the retention sub-sync
- [x] B9. Tests: 21 in tests/billing-stripe.test.ts (signature pos/neg/expired/multi-v1, row mapping fixtures, event routing, webhook 503/400 guards before any Supabase touch); no supabase-js chain mocks. Full suite 606 pass, lint + tsc clean
- [x] B10. middleware.ts exempts /api/billing/webhook from the optional API_TOKEN gate (Stripe cannot send our token; the route self-authenticates via signature) - subworker decision, approved

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
