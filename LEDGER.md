# Ledger — round 2026-07-18c (closed 2026-07-18)

Previous round 2026-07-18b closed and preserved in git history (02dcf5b).

## Monetization Phase 2 (MONETIZATION.md section 4, dark launch)
- [x] 1. Granular per-feature paid/free control: `feature_flags.required_plan` ('free'|'pro', check constraint), owner-editable at runtime on /admin/flags (9d02122, 4826b5d)
- [x] 2. Default everything free: column default 'free', no flag seeded 'pro', plan_limits seeded null/null — browser-verified zero change in guest mode (all features still on)
- [x] 3. `plan_limits` table shipped (watchlistItems/savingsPlans/portfolios, null = unlimited); enforcement stays Phase 4
- [x] 4. Migration 0065_plan_gating.sql + schema.sql mirrored in the same change, all statements idempotent
- [x] 5. Resolution order implemented exactly: override wins outright (= Pro grant) > kill switch > pro+free = locked > on; no Supabase / missing row = on + free (lib/flags/resolve.ts, pure, 11 tests)
- [x] 6. `useFeature(flag): {enabled, locked}` added; `useFeatureFlag` keeps boolean contract (enabled && !locked), all existing call sites unchanged
- [x] 7. `usePlan()` seam returns 'free' until billing ships; pure `resolvePlan` (active/trialing/past_due+7d grace) implemented + 8 tests so Phase 1 only wires it
- [x] 8. /admin/flags: Plan column (Free/Pro SelectMenu per row) via new API kind "plan" (requireAdmin + audit "flag.set_plan"); both admin tables gained the missing sort + row hover (standing rule)
- [x] 9. Flags fetch robust against a prod DB lagging the migration: select("*") + defensive reads, missing column = 'free'
- [x] 10. Closed-by-default enabled semantics untouched; no badges; 585 tests + lint green after each step
- [~] 11. plan_limits admin editor + limit enforcement deferred (Phase 4)
- [~] 12. Stripe billing (Phase 1) deferred: needs owner's Stripe account/keys (MONETIZATION.md open decision 6)
- [ ] 13. OWNER ACTION: apply migration 0065 in Supabase before using the /admin/flags plan column on prod

## Process
- [x] 14. 2x Sonnet sequential (second continued for the sort/hover follow-up), ledger before each delegation, per-task commits, no branches
- [x] 15. CLAUDE.md updated (plan-gating paragraph in the feature-flags section)
