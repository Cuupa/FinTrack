# Ledger — round 2026-07-17e (closed 2026-07-18)

## Prio 1: Uncommitted changes
- [x] 1. Review the pending LLM-context/beta-alpha + settings-intro changes
- [x] 2. Verify: vitest suite green (550 passed), lint clean
- [x] 3. Commit the feature changes (914ceeb)
- [x] 4. Commit the LEDGER.md rotation (d039eff)
- [x] 5. .idea/ gitignored (d039eff)

## Asset page
- [ ] 6. Transactions table on /assets/[id] shows the portfolio the transaction belongs to
- [x] 7. Decision: column only when portfolios.length > 1 (matches existing multiPortfolio pattern)
- [ ] 8. New column sortable (by portfolio name); add missing row hover highlight (user rule)
- [ ] 9. Edit mode: portfolio SelectMenu moves inline into the new column cell; second-row hack removed
- [ ] 10. Reuse existing `tx.portfolio` key; any new keys land in en+de+es

## Asset page (done)
- [x] 6. Portfolio column in /assets/[id] transactions table (d9b5ff5)
- [x] 8. Sortable by portfolio name; row hover highlight added
- [x] 9. Edit-mode SelectMenu inline; second-row hack removed
- [x] 10a. Reused `tx.portfolio`, no new keys

## Fees
- [x] 10. Audit: TransactionForm + AddAssetForm already zero the auto-fee for CASH (`!isCash && orderFee(...)`)
- [ ] 11. Gap: savings-plans card prefills `savingsPlanFee` for CASH plan rows too — set feeDefault 0 for CASH
- [ ] 12. Manual per-row fee edit stays possible for CASH (input already editable); security plans unaffected
- [ ] 12a. Test coverage for the CASH fee default

## Fees (done)
- [x] 11. Savings-plans card: CASH rows feeDefault 0 (a2ba285)
- [x] 12. Manual per-row fee edit retained; security plans unaffected
- [x] 12a. deriveRow tests added (tests/savings-plans.test.ts)

## Overview
- [ ] 13. Dashboard/overview page gets the ghost "?" replay button for its onboarding tour (parity with risk/rebalancing/simulation/tags pages)
- [ ] 13a. GuidedTour gains restartToken (key + forceOpen), button next to dashboard heading, only in loaded branch

## Overview (done)
- [x] 13. Dashboard "?" replay button (59635f4), verified in-app: reopens tour after done

## UI pass
- [x] 14a. Browser walkthrough done (dashboard, asset, analysis, dividends, xray, rebalancing, simulation, settings; DE, 1920x1080)
- [x] 14b. In-app verification: portfolio column + sort + inline edit select OK; tour replay OK
- [x] 14c. Bug fixed: hero "Change (1Y)" -100% for day-one portfolio (Opus-confirmed double-counted baseline flow; pure `windowChange` in lib/finance/returns.ts + tests; 1a34ec2). Browser-verified: now 0,00 EUR / 0,00 %
- [x] 14d. Bug fixed: amber missing-fields state after successful submit (`useFormTouched` gained `reset`; 7695ace). Browser-verified: hint gone
- [x] 15. No badges anywhere observed; skeletons in use; tables sortable + hover

## Process
- [x] 16. One subworker at a time (3x Sonnet, 1x Opus, sequential); ledger updated before each delegation
- [x] 17. Each task committed separately, no branches (914ceeb, d039eff, d9b5ff5, a2ba285, 59635f4, 1a34ec2, 7695ace)
- [x] 18. CLAUDE.md updated (windowChange invariant in finance-core section)
