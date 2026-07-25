# LEDGER — ROADMAP items #11, #13 (skip #12 per instruction)

Continuing the sequence from items #1-#10 (see git history). Each item fully
shipped (data model + store seam + finance module + UI + i18n en/de/es +
tests + build/lint green) and committed before moving to the next.

## Item #11: Tax pack (flag `taxPack`) — DONE
- [x] Migration 0090 + schema.sql: `spending_categories.tax_deductible`
      (nullable boolean) + flag seeded disabled
- [x] `lib/types.ts`: `SpendingCategory.taxDeductible?: boolean`
- [x] Store seam: supabase-store.ts row mapping (Local/Offline/sync are
      generic passthrough, no changes needed)
- [x] `lib/finance/tax-pack.ts` (pure): `taxPackByYear` — deductible expense
      totals by category + income/expense context per calendar year, from
      the spending ledger
- [x] Export: extend `lib/export/export.ts` with a per-year advisor/Elster
      CSV export combining `TaxYearBreakdown` (capital gains) + `TaxPackYear`
      (deductible expenses + income context)
- [x] UI: extend `components/analysis/tax-view.tsx`'s existing "Steuern" tab
      with a deductible-expenses section + export button per year (gated on
      `taxPack`), plus standalone cards for spending-only years that have no
      capital-gains event (taxYearBreakdown only returns years with a
      taxable event, so a pure-spending year would otherwise never render);
      `components/spending/category-manager.tsx` gains a tax-deductible
      toggle per category (gated on `taxPack`)
- [x] i18n en/de/es
- [x] Unit tests: 5 cases in tests/tax-pack.test.ts
- [x] Verify: build + lint + unit tests green (901 passing), browser smoke
      test in Guest Mode EN+DE (account -> tax-deductible category -> 300 EUR
      spend -> Steuern/Tax tab shows the deductible total + export button ->
      CSV downloads with correct capital/deductible/income sections, zero
      console errors)

## Item #13: Household / collaboration (flag `household`)
User picked "full read/write shared ownership" (not the smaller read-only
viewer option) when asked. Given the true size (household-aware RLS would
touch 15+ existing tables + every store read path), scoping this round to
two parts, explicitly:
1. Household core: `households` + `household_members` (one household per
   user, enforced by a unique index -- avoids multi-household ambiguity in
   v1) + `household_invites` (email-matched, no email delivery infra exists
   so invites surface in-app to the invited user via an RLS-visible pending
   row, not a sent email). Two SECURITY DEFINER helper functions
   (`my_household_id()`, `household_peer_ids()`) so per-table RLS policies
   can extend to "own row OR a household peer's row" without recursive RLS
   on `household_members` itself. Full CRUD UI: create, invite by email,
   accept/decline, member list, remove member, leave, role (owner/member).
2. First shared entity, end-to-end: `accounts` + `account_balances` (the
   roadmap's own "everything" keystone) get household-peer RLS + store
   changes, so a household actually shares net-worth-relevant data, not just
   membership plumbing.
- [x] Migration 0091 + schema.sql: households/household_members/
      household_invites tables + RLS + helper functions, flag seeded
      disabled
- [x] `lib/types.ts`: `Household`, `HouseholdMember`, `HouseholdInvite`
- [x] `lib/household/` (new): `HouseholdProvider` context (own seam,
      parallel to `BillingProvider`/`FeatureFlagsProvider` -- household
      membership is per-user, not per-portfolio, so it doesn't belong in
      `PortfolioData`) + a thin direct-Supabase data layer (no LocalStore
      equivalent -- household collaboration is inherently a registered-mode,
      multi-account feature, like billing)
- [x] Migration 0092: extend `accounts`/`account_balances` RLS with
      `household_peer_ids()`; extended `SupabaseStore`'s accounts read/write
      (load queries drop the explicit `.eq("user_id", ...)` filter and trust
      RLS; update/delete drop it too; `setAccountBalances` now attributes
      balance rows to the ACCOUNT'S owner, looked up via RLS, not the acting
      editor -- a peer editing someone else's account must not reassign the
      balance history to themselves)
- [x] UI: `/household` route (create/invite/members/leave), sidebar nav entry
- [x] i18n en/de/es
- [x] Found and fixed a real RLS bug during review: the `household_members`
      "join household" INSERT check's "did I create this household" branch
      read `households` via a plain (non-security-definer) subquery, which
      is itself gated by that table's own SELECT policy -- at creation time
      the creator isn't a member yet, so `my_household_id()` is null and the
      household row was invisible to its own creator's join-check, making
      household creation impossible. Fixed by adding `or created_by =
      auth.uid()` to the households SELECT policy. Caught by manual
      read-through, not by any test (RLS isn't exercised in CI -- no DB).
- [x] Verify: build + lint + unit tests green (896 passing), browser smoke
      test in Guest Mode EN+DE (flag-gated nav entry renders, `/household`
      shows the registered-only fallback, zero console errors). Full
      create/invite/accept/leave flow and RLS behavior are **NOT** live-
      tested against a real Supabase project -- local dev has no Supabase
      connection (Guest Mode only) and I did not apply these migrations to
      the production project. **Before this is live, the owner must run
      migrations 0091 and 0092 against the Supabase project and do a manual
      two-account smoke test** (create household as user A, invite user B,
      accept as B, confirm B sees A's accounts and vice versa, confirm a
      third unrelated user sees neither).

**Explicitly NOT done this round** (documented in ROADMAP.md as follow-up):
portfolios, assets, transactions, spending_categories/spending_transactions,
budgets, contracts, goals, watchlist_items, savings_plans, tag_groups/
asset_tags, llm_settings do not get household-peer visibility yet. Same
`household_peer_ids()` pattern applies mechanically per table -- each is a
small, independently reviewable migration + store change, not a redesign.

## Skipped
- #12 Document vault — explicitly excluded by user instruction this round.
