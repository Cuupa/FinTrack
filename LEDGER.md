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
Scope TBD — XL effort, flagged in ROADMAP.md "Open decisions #4" as needing
an owner call on the data model before starting. Will scope a v1 and check
with the user before writing schema/RLS given the security blast radius of
getting shared-data access wrong.

## Skipped
- #12 Document vault — explicitly excluded by user instruction this round.
