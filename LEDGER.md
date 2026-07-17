# Ledger — round 2026-07-17e

## Prio 1: Uncommitted changes
- [ ] 1. Review the pending LLM-context/beta-alpha + settings-intro changes
- [ ] 2. Verify: vitest suite green, lint clean
- [ ] 3. Commit the feature changes with a short meaningful message
- [ ] 4. Commit the LEDGER.md close-out (deletion is staged) with the new round ledger
- [ ] 5. Keep .idea/dataSources.xml out of the repo (IDE noise, may carry DB details) — gitignore it

## Asset page
- [ ] 6. Transactions table on /assets/[id] shows the portfolio the transaction belongs to
- [ ] 7. Only meaningful when >1 portfolio exists (decide: always show vs conditional)
- [ ] 8. New table column stays sortable; row hover highlight preserved (user rule)
- [ ] 9. Dictionary keys land in en+de+es (es parity test); German uses du-register

## Fees
- [ ] 10. CASH transactions get no fee prefill by default (fee model must not prefill for CASH)
- [ ] 11. Manual fee entry per transaction still possible for CASH
- [ ] 12. Savings-plan fee prefill unaffected unless CASH is involved

## Overview
- [ ] 13. Dashboard/overview page gets the ghost "?" replay button for its onboarding tour (parity with risk/rebalancing/simulation/tags pages)

## UI pass
- [ ] 14. Find and fix bad UI/UX from a user's point of view (browser walkthrough, EN+DE, desktop 1080p)
- [ ] 15. No badges anywhere; skeleton loading not placeholders; tables sortable + hover highlight

## Process
- [ ] 16. One subworker at a time; ledger updated before each delegation
- [ ] 17. Each task committed separately, short meaningful message, no branches
- [ ] 18. Update CLAUDE.md where behavior/architecture docs change
