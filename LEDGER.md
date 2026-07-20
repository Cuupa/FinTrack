# Ledger - round 2026-07-20c (COMPETITION.md Wave 3)

Wave 3 = F7 (interest-bearing cash), F8 (OTHER manual-valuation asset), F9
(custom benchmarks), F10 (persisted rebalancing). **F9 already shipped**
(c60ee97). Remaining: F7, F8, F10. Working one at a time, commit each.

## Constraints (unchanged): no em-dash, du/tu register, NO badges, sortable
tables + row hover, skeletons not placeholders, commit per task, no branches,
lint+tsc+test+build green before each commit. Every feature: en+de+es, flag
row, schema.sql + migration both idempotent.

## F7 - Interest-bearing cash (closes G8). Effort M.

Design (orchestrator): a CASH asset carries an annual interest rate +
compounding frequency; interest accrues and is booked as INTEREST
transactions (type already exists, bc712f7, zero-cost-basis, counts as
return) after an explicit review step, mirroring savings plans.

- Data: 2 optional nullable fields on `Asset` (per-holding, on `assets` row).
  `interestRate?: number|null` (annual %, e.g. 3.5), `interestFrequency?:
  InterestFrequency|null` (MONTHLY|QUARTERLY|ANNUAL, new union in types.ts).
  `AssetInput = Omit<Asset,"id">` so LocalStore/OfflineStore/queue thread it
  automatically; only SupabaseStore + schema need explicit work.
- Finance core: `lib/finance/cash-interest.ts` (pure). `dueInterest(asset,
  txs, today, max=60)` -> `{date, amount}[]`: period boundaries at first-tx
  anchor + k periods, resuming after the last booked INTEREST tx; per payout
  the amount = runningCashBalance * rate/100 / periodsPerYear, compounding
  through previously-proposed rows in the batch. Balance = signed sum of the
  asset's txs (BUY/BOOKING/INTEREST +, SELL -) as of the payout date.
- UI: config + review-and-book live on the CASH asset detail page (one new
  component, `CashInterestSection`) - canonical editor supports later rate
  changes; books INTEREST txs at price 1 into the asset's existing portfolio.
  Flag-gated `cashInterest` (seeded disabled).
- i18n en/de/es. Vitest over the pure function. schema.sql + migration 0077.

- [x] F7a. types.ts: InterestFrequency + Asset fields (optional, so existing
      literals stay valid; AssetInput auto-threads through Local/Offline).
- [x] F7b. lib/finance/cash-interest.ts + 12 tests (compounding, resume after
      last booked, mid-period deposit, quarterly, day clamp, cap). Note: a
      pre-existing tests/cash-interest.test.ts covers the INTEREST tx TYPE
      (bc712f7) - accrual tests live in tests/cash-interest-accrual.test.ts.
- [x] F7c. SupabaseStore mapping (AssetRow, select, addAsset, updateAsset now
      builds a partial update object for notes + both interest fields).
- [x] F7d. schema.sql + migration 0077 (assets cols + cashInterest flag seed
      disabled) + FeatureFlag union.
- [x] F7e. CashInterestSection (self-contained; config + review-and-book) on
      asset detail, gated held+CASH+flag; i18n en/de/es (cashInterest.*).
- [x] F7f. lint+tsc clean, vitest 764 pass, build green. Verified Guest Mode
      DE + EN: seeded 10k Tagesgeld dated 2026-01-15, 3.6% monthly -> 6
      compounding credits (30.00/30.09/30.18/30.27/30.36/30.45), booked ->
      balance 10,181.35, "Erhaltene Zinsen" 181.35, due bar clears, next
      credit date shown, all 6 INTEREST rows in the tx log. No badges,
      du/tu register correct.

## F10 - Persisted rebalancing targets (closes G11). Effort M. DONE.

Design: the /rebalancing plan (target weights by row id + freely-added custom
positions + trade/buy-only mode) was client-only, forgotten on reload. Persist
it as a jsonb blob on the profile (`Profile.rebalanceTargets`), riding the
existing `updateProfile` store-seam mutation exactly like `toursDone` /
`taxVorabpauschale` - no new table, no new mutation, auto-threads through
Local/Offline/sync. The view seeds its editable state once from the hydrated
plan (page gates the mount behind `!loading`) and writes back debounced
(700ms + unmount flush). Buy-only ("invest new money") mode already shipped.

- [x] F10a. types.ts RebalancePlan + Profile.rebalanceTargets + default.
- [x] F10b. SupabaseStore: profile select/map (normalizeRebalancePlan coerces
      a partial/`{}` jsonb) + saveProfile write.
- [x] F10c. schema.sql + migration 0078 (profiles.rebalance_targets jsonb,
      default the empty plan).
- [x] F10d. rebalancing-view seeds from plan + debounced persist (lint-safe:
      no ref reads in render, seed via useState initializer); collision-safe
      custom ids; localized new-position name (new key rebalance.newPositionName
      en/de/es). Page gates mount on !loading with a skeleton.
- [x] F10e. lint+tsc clean, vitest 764 pass, build green. Verified Guest Mode
      EN: set Tagesgeld 60% + custom "Gold ETF" 40% + buy-only, reloaded ->
      plan fully restored (60/40, name, mode, donut, buy actions). DE reuses
      the pre-existing translated rebalance.* keys + the one new key; view
      formatting unchanged.

NOTE: F10's optional "per-tag-group targets" sub-idea is NOT built - the core
gap (targets forgotten on reload) + invest-new-money are done. Per-tag targets
would be a follow-up enhancement, flagged here rather than silently dropped.

## F8 - OTHER manual-valuation asset (closes most of G9). Effort M. DONE.

Design (orchestrator): a new `AssetType` `OTHER` (real estate, collectibles,
unlisted holdings). The user enters dated valuation points; those points form
the asset's price series **through the PriceProvider seam** exactly as the plan
intends. A module-level registry (`lib/finance/manual-valuation.ts`, mirroring
the catalog cache that prices.ts already reads synchronously) maps price key ->
sorted points; `prices.ts` `currentPrice`/`priceOn` return the manual value for
OTHER assets, falling back to synthetic only before any point exists. Because
everything (summarize, net worth, allocation, detail chart) already routes
through prices.ts, no per-caller history threading is needed. The registry is
repopulated in the PortfolioProvider during render (useMemo, parent-before-child
render order guarantees children see fresh values - no version thread).

- Data: `ValuationPoint {assetId, date (YYYY-MM-DD), value (per-unit, native)}`;
  `PortfolioData.valuationPoints`. Store seam replace-set `setAssetValuations(
  assetId, [{date,value}])` (idempotent/replay-safe like setAssetTags). LocalStore
  blob + deleteAsset cascade; SupabaseStore `asset_valuations` table + load;
  OfflineStore mirror+queue; sync replay; mutation-queue op.
- Finance: registry module + prices.ts (currentPrice/priceOn/hasManualValuation)
  + portfolio.ts (isSyntheticPrice, priceFactor=1 for OTHER-with-points,
  netWorthSeries synthetic flag, assetPriceSeries synthetic flag). stats.ts
  GENERAL[OTHER] + allocation.ts (volForAsset, lookThrough OTHER bucket).
- UI: add-asset-form (OTHER = name-only manual entry, seeds first valuation
  point from the opening tx, flag-gated type button); asset-detail
  `ValuationSection` (add/edit/delete points, gated held+OTHER+flag), dividends
  skipped for OTHER; asset-table TYPE_FILTERS. Flag `manualValuation` seeded
  disabled. i18n en/de/es. schema.sql + migration 0079. Vitest over registry.

- [x] F8a. types.ts: AssetType/ASSET_TYPES + OTHER; ValuationPoint +
      PortfolioData.valuationPoints + emptyPortfolio.
- [x] F8b. lib/finance/manual-valuation.ts registry + pure lookups + tests.
- [x] F8c. prices.ts + portfolio.ts + stats.ts + allocation.ts + slice-label.ts.
- [x] F8d. store seam: types, local, supabase, offline, mutation-queue, sync.
- [x] F8e. portfolio-context: data field, setAssetValuations mutation, registry
      populate useMemo. flags-context union. schema.sql + migration 0079.
- [x] F8f. add-asset-form, valuation-section, asset-detail wiring, asset-table.
- [x] F8g. i18n en/de/es. lint+tsc clean, vitest 770 pass (6 new registry
      tests), build green. Verified Guest Mode EN+DE: added an OTHER asset via
      manual entry (qty prefilled 1), it shows in the holdings table + net
      worth; detail page renders the Valuation section (sortable DATE/VALUE
      table, row hover, current-value line), adding a 345k point moved the
      current value + headline + chart line + unrealized P&L (+15%/45k vs the
      300k basis); DE "Bewertung"/"Sonstiges" correct, du-register, no formal
      "Sie", no badges. EN "Valuation"/"Other" correct.

NOTE: Deliberate scope boundary (matches the plan's "bonds stay out"): an OTHER
asset's risk/Monte-Carlo stats still fall back to the synthetic daily series
(stats.ts dailyPrices), since sparse manual points don't yield a daily return
series. Net worth, allocation, P&L and the detail chart are all exact. Bonds
and per-unit-vs-total nuance out of scope.
