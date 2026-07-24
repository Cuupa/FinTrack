# LEDGER — ROADMAP item #3: Bank-statement import → spending (flag `spending`)

Extends `lib/import/csv.ts`'s "generic header-driven parser, drop your export,
nothing duplicates" pattern to `spending_transactions`: a new bank-statement
CSV parser + its own fingerprint/reconcile pair (row shape is date/amount/
payee/note, not ISIN/qty/price, so it's a parallel module, not a branch in the
existing investment-import one), wired into a new import modal on `/spending`.
Category rules (`lib/finance/categorize.ts`) auto-suggest on preview.

## Tasks
- [x] 1. Migration 0082 + schema.sql: `imported_spending_rows` table (own-row
      RLS, FK cascade on `spending_transaction_id`), idempotent
- [x] 2. `lib/import/spending-csv.ts` (pure): `ParsedSpendingRow`,
      `parseSpendingCsv` (generic header-driven, DE/EN column aliases +
      DE/EN decimal formats), `spendingFingerprint`
- [x] 3. `lib/import/spending-reconcile.ts` (pure): `reconcileSpending`
      (new/conflict/imported vs existing spending transactions of the target
      account)
- [ ] 4. `DataStore` seam: `loadImportedSpendingFingerprints` /
      `addImportedSpendingFingerprints` (types.ts)
- [x] 5. LocalStore: own storage key + cascade-prune on
      deleteSpendingTransaction/deleteAccount
- [x] 6. SupabaseStore: load/upsert against `imported_spending_rows`
- [x] 7. OfflineStore: mirror + best-effort inner (same pattern as
      `addImportedFingerprints` — not queued)
- [x] 8. PortfolioProvider: expose the two new methods
- [x] 9. UI: `components/spending/import-spending.tsx` (file picker, account
      picker, new/conflict/imported counts, category auto-suggest, confirm)
      opened from a button on `spending-view.tsx`
- [x] 10. i18n en/de/es keys
- [x] 11. Unit tests: parser + fingerprint + reconcile
- [x] 12. Verify: build + lint + unit tests green; guest round-trip in-app
      (import same file twice -> second import is a no-op)

## Notes
- No PDF parser exists anywhere in the tree yet (ROADMAP's "+ the PDF parser"
  aside is aspirational) — this item ships CSV-only, matching what
  `lib/import/csv.ts` actually does today.
- Fingerprint key is `accountId|date|amount|payee` (not global like the
  investment fingerprint) since spending rows carry no cross-account
  identifier — the same statement re-imported against a different account is
  legitimately a different set of transactions.
- No `/datenschutz` update needed: same client-side-only CSV parsing pattern
  as the existing investment import, which never got its own privacy-policy
  section either.
