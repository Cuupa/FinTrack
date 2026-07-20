# Competition analysis

Researched 2026-07-19. Complements ROADMAP.md (last competitor review
2026-07-05); this document reflects what has shipped since (dividends
dashboard, savings plans, tax report, watchlist, COMMODITY/gold, tags on the
store seam, BYO-key LLM chat, Spanish locale, dark-launched Stripe billing)
and re-checks the field. Target user: the German/European self-directed
retail investor.

---

## 1. The field

### Direct competitors (DACH)

| Product | Model | Pricing | Positioning |
| --- | --- | --- | --- |
| **Parqet** | Freemium web + mobile | Free capped at 10 transactions; Plus 5.99 EUR/mo; Pro 9.99 EUR/mo | Polish + breadth: 50+ broker imports, dividend suite, tax dashboard, X-Ray, news, widgets, hosted AI Q&A |
| **getquin** | Freemium web + mobile | Free base; Premium ~89.99 EUR/yr | "LinkedIn for investors": community + tracking, broad asset coverage (incl. real estate, art), broker sync via finAPI/SnapTrade/Flanks |
| **Finanzfluss Copilot** | Freemium web + mobile | Free base; PLUS 8.99 EUR/mo | Whole-net-worth: automated connections to 350+ banks/brokers, Haushaltsbuch (budgeting), dividend calendar |
| **Portfolio Performance** | Open source desktop | Free | Correctness gold standard: TTWROR/IRR everywhere, PDF import for dozens of brokers, taxonomies + rebalancing, local file, no cloud |
| **DivvyDiary** | Freemium web + mobile | Free base; Premium 5.99 EUR/mo | Dividend calendar specialist: 68k+ payers, push notifications, imports from Portfolio Performance |

### International reference points

| Product | Pricing | Notable |
| --- | --- | --- |
| **Sharesight** | Free capped; 7 to 23 USD/mo | ~240 broker feeds, automatic corporate actions, per-country tax reporting, SOC 2, separates capital vs currency gains |
| **Snowball Analytics** | ~14.99 USD/mo | Dividend-first, 25+ currencies, custom assets, goal tracking, rebalancing |
| **Kubera / Capitally / Tukhe / DonkyCapital** | paid | Newer "whole wealth" trackers; mostly aggregation-driven, not DACH-tax-aware |

Common user complaints across the paid cloud trackers (app-store reviews,
comparison blogs): broker auto-sync breaks silently or imports wrong data,
free tiers are crippled (Parqet's 10-transaction cap is the canonical
example), and full analysis sits behind the subscription.

---

## 2. What competitors lack, but FinTrack has

These are the moats. Every fix planned in section 4 must not erode them.

1. **Full feature set free, no account, no caps.** Guest Mode runs the entire
   app from localStorage. Parqet caps free at 10 transactions, getquin and
   Copilot paywall the analysis depth, Sharesight caps holdings. Nobody else
   offers the complete product before signup. (The dark-launched billing must
   keep this: monetize convenience and future pro depth, never the core
   tracker; `plan_limits` is seeded unlimited for exactly this reason.)
2. **Privacy by architecture, verifiable in code.** No analytics, no bank
   credentials, all market-data calls server-proxied, CSP locked to
   self + Supabase, a privacy policy that makes checkable claims. Copilot and
   getquin need bank logins for their headline features; every cloud
   competitor runs analytics.
3. **Privacy-consistent AI.** The LLM chat is BYO-key, provider-agnostic,
   proxied without logging, and the user chooses where the key lives. Parqet's
   AI Q&A routes portfolio data through Parqet's own integration. FinTrack is
   the only tracker where AI access does not create a new data dependency.
4. **Offline-first PWA with a sync queue.** Only Portfolio Performance (a
   desktop file) works offline at all; no cloud competitor does.
5. **Monte Carlo with measured parameters.** Per-asset mu/sigma plus a
   Cholesky correlation model estimated from the user's real histories. None
   of the DACH four ship a portfolio-calibrated simulation.
6. **Per-broker fee models and per-broker Freistellungsauftrag.** The tax
   report shields each broker's gains with its own allowance and pools the
   remainder. Competitors model at most one global allowance; most model
   none.
7. **Honest data labeling.** Synthetic/estimated series are visibly marked.
   Competitors silently interpolate gaps, which is a repeated complaint in
   Parqet reviews ("incorrect data displays").
8. **Historical FX done right.** Multi-year charts of foreign-currency
   holdings use the rate at each point date, not today's spot. Most trackers
   (including PP in default setups) get this subtly wrong.
9. **No lock-in.** One-click full CSV + JSON export that round-trips through
   the app's own importer.
10. **Free ETF X-ray.** Parqet paywalls X-Ray behind Plus/Pro; getquin behind
    Premium. FinTrack's look-through is free.
11. **Read-only share links** that the recipient can open without an account.

---

## 3. What FinTrack lacks, but competitors have

Severity scale:
- **High**: costs acquisition or data correctness today; users pick a
  competitor over this, or trust the numbers less.
- **Medium**: depth/retention gap; a workaround exists but is friction.
- **Low**: nice-to-have, or deliberately off-positioning.

| # | Gap | Who has it | Severity | Why this rating |
| --- | --- | --- | --- | --- |
| G1 | PDF statement import | PP (dozens of brokers), Parqet/getquin partially | **High** | German brokers ship PDFs by default; CSV exports are hidden or missing (Trade Republic has no CSV). This is the #1 onboarding wall and PP's moat. |
| G2 | Import from Portfolio Performance (CSV/XML) | DivvyDiary imports PP; Parqet has migration paths | **High** | PP users are the exact target audience (correctness-minded, privacy-minded, fee-averse) and currently cannot migrate. Cheapest large win. |
| G3 | Broker/bank auto-sync | Copilot (350+), getquin (finAPI/SnapTrade/Flanks), Parqet (partial), Sharesight (~240) | **High** (acquisition), but strategically conflicted | The single biggest convenience differentiator, and the most common source of competitor complaints (silent sync failures). Contradicts "your data never leaves your control" and costs real money (wealthAPI/finAPI licensing). |
| G4 | Announced dividend calendar (confirmed ex/pay dates ahead of time) | Parqet, getquin, Copilot, DivvyDiary | **Medium** | FinTrack forecasts from trailing payouts; competitors show confirmed upcoming payments. Dividend investors notice the difference immediately. |
| G5 | Push notifications (dividend pay-day, savings-plan due) | Parqet, DivvyDiary, Copilot, getquin (native apps) | **Medium** | Re-engagement driver; the PWA can do web push without native apps. |
| G6 | Stock splits / corporate actions | Sharesight (automatic), PP (manual booking type) | **Medium**, rising | No split transaction type exists. After a split, Yahoo prices are split-adjusted but the replayed position count is not: the holding is silently wrong. Correctness gap in a product that competes on correctness. |
| G7 | Vorabpauschale auto-estimate | Parqet tax dashboard; PP via manual booking | **Medium** | Currently a manual per-year entry (`TaxSettings.vorabpauschale`). Computable from Basiszins + fund holdings + year-start values; a DE-specific trust-builder no free product does well. |
| G8 | Interest-bearing cash (Tagesgeld/Festgeld) | Copilot (wedge feature), Parqet | **Medium** | CASH exists but accrues no interest; users holding Tagesgeld see a flat line and drift to Copilot for the "whole picture". |
| G9 | More asset classes: bonds, real estate, "other" manual-valuation | getquin (real estate, art, metals), Copilot, PP, Snowball | **Medium** | COMMODITY (gold) shipped; bonds and manual-valuation assets are still unrepresentable, so mixed-wealth users cannot see their whole net worth. |
| G10 | Custom benchmarks (any ISIN) | PP, Parqet | **Low-Medium** | Five hardcoded benchmarks; the compare machinery already normalizes arbitrary series. |
| G11 | Persisted rebalancing targets + "invest new money" mode | PP (taxonomies + rebalancing), Snowball | **Low-Medium** | `/rebalancing` has an editable target grid but it is client-only and forgotten on reload; no per-tag targets, no cash-inflow planner. |
| G12 | Native mobile apps + home-screen widgets | Parqet, getquin, Copilot, DivvyDiary | **Low** (deliberate) | The PWA is the strategy (ROADMAP non-goal). Widgets are the only real loss; revisit only if PWA engagement data demands it. |
| G13 | News per holding | Parqet, getquin | **Low** | No sustainable server-side source; Yahoo's endpoints are rate-limit-fragile. Off the critical path. |
| G14 | Community / portfolio discovery | getquin (moat), Parqet (community benchmarks) | **Low** (off-brand) | Social is getquin's identity, not FinTrack's. Share links cover the sharing need. |
| G15 | Multi-country tax reporting | Sharesight | **Low** | FinTrack is DE-tax-aware by design; other jurisdictions are a different product. |

---

## 4. Plan to close the gaps

Ordered by (value / effort), respecting the existing seams. Every item ships
behind a `feature_flags` row, lands in en + de + es, and updates both
`schema.sql` and a migration where the data model changes. Estimates: S under
a day, M a few days, L a week plus.

### Wave 1: the migration funnel (High severity, mostly S/M effort)

**F1. Portfolio Performance import (closes G2). Effort: S-M.**
Add a `portfolioPerformance` `BrokerFormat` to `lib/import/csv.ts` that
parses PP's CSV export (transactions + securities), exactly like the existing
`fintrack` round-trip format. Reconciliation, fingerprints, and the
three-pane merge are reused unchanged. PP's XML file format is the follow-up
(client-side parse, same `ImportedRow` shape). Marketing effect exceeds the
code size: "switch from Portfolio Performance in one file".

**F2. PDF statement import, client-side (closes G1). Effort: L.**
Parse broker PDFs with `pdfjs-dist` **in the browser** (bundled, so CSP stays
untouched and the privacy story holds: the statement never leaves the
device). New pure module `lib/import/pdf/` with per-broker text-layout
parsers, starting with the three highest-volume brokers (Trade Republic,
Scalable Capital, ING), emitting the existing `ImportedRow` shape so
reconcile/fingerprint/merge are reused unchanged. Test fixtures: anonymized
text extractions (real PDFs stay gitignored like the broker CSVs). Ship one
broker at a time behind flag `importPdf`.

**F3. Split/corporate-action transaction type (closes G6). Effort: M.**
New `TransactionType` `SPLIT` carrying a ratio; `portfolio.ts` replay
multiplies the share count from the effective date (average-cost basis is
unchanged in total, per-share recomputed). Follow the compiler through the
`Record<TransactionType,...>` sites. CSV/PDF parsers map broker split rows
when present; manual entry via the transaction form otherwise. This is a
correctness fix and should not be flag-gated longer than one verification
round.

### Wave 2: dividend and tax depth (Medium severity, differentiating)

**F4. Announced dividend calendar (closes G4). Effort: M.**
Extend `lib/server/yahoo.ts` with the calendar/events endpoint (through
`getJSON`, same semaphore/backoff), surface upcoming confirmed ex/pay dates
in `/api/dividends`, and render them in the existing `/dividends` forecast
card (confirmed events replace the trailing projection for the covered
window; the projection remains the fallback and keeps its estimated
labeling). Pure merge logic next to `projectDividends`.

**F5. Web push notifications (closes G5). Effort: M.**
Service-worker push (VAPID) for two events only: dividend pay-day and
savings-plan due. Opt-in per event type in settings, subscription endpoint
stored per user (registered mode only; the PWA already has the service
worker). Cron job checks due events. Strictly no marketing pushes: the
privacy positioning makes notifications a trust surface. Flag `pushNotifications`.

**F6. Vorabpauschale estimator (closes G7). Effort: M.**
Pure function in `lib/finance/tax.ts`: per fund-year, min(Basiszins formula,
value gain) on year-start holdings, 30% Teilfreistellung for equity funds.
Basiszins per year is reference data and belongs in the DB
(`app_config`-style table, owner-seeded, world-readable) per the
no-hardcoded-reference-data rule. The existing manual entry stays as an
override (broker statements are authoritative); the estimate fills years the
user has not entered, labeled as estimated.

### Wave 3: whole-net-worth breadth (Medium severity)

**F7. Interest-bearing cash (closes G8). Effort: M.**
Optional interest rate + compounding rule on CASH assets; accrue as clearly
labeled synthetic interest transactions with a review step (same
review-before-book pattern as savings plans). ROADMAP item 5, unchanged.

**F8. Manual-valuation asset class (closes most of G9). Effort: M.**
`AssetType` `OTHER`: user-entered valuation points form the price series
through the `PriceProvider` seam (built to absorb exactly this). Covers real
estate, collectibles, unlisted holdings. Bonds stay out until demand shows
(YTM/pricing is a rabbit hole; ROADMAP agrees).

**F9. Custom benchmarks (closes G10). Effort: S.**
Benchmark picker searches the catalog + `/api/lookup` by ISIN;
`use-benchmark-compare.ts` already normalizes series. Keep the five curated
defaults as suggestions.

**F10. Persisted rebalancing targets + invest-new-money (closes G11). Effort: M.**
Persist the target grid through the store seam (new table + LocalStore twin,
replay-idempotent), add per-tag-group targets (tags already ride the seam),
and an "I have X EUR, what do I buy to converge" mode that only ever suggests
buys (tax-friendlier, matches savings-plan behavior).

### Deliberate decisions, not backlog items

**G3 (broker auto-sync): decide, don't drift.** Recommendation: do not build
it now. It is the competitors' biggest feature and their biggest source of
complaints; it costs licensing money (wealthAPI/finAPI class aggregators) and
directly contradicts the privacy architecture that is FinTrack's moat.
Instead, make import so good it beats sync on trust: F1 + F2 + the existing
fingerprint dedupe give a "re-import your statement folder monthly, nothing
duplicates" workflow. Revisit only when (a) import covers the top 5 brokers
via PDF and (b) there is revenue to pay for aggregation, and then only as an
explicit opt-in labeled as leaving the privacy envelope. This gate is the
Phase-4-style decision the ROADMAP already sketched; write the decision down
when it is made.

**G12 (native apps/widgets), G13 (news), G14 (community), G15 (multi-country
tax): remain non-goals.** The PWA, the share links, and the DE tax focus are
positioning, not omissions. Re-evaluate G12 only on PWA engagement data.

### Sequencing vs monetization

Wave 1 grows the funnel (migration + correctness) and should land while
billing is still dark-launched: switching costs drop exactly when the free
tier is at its most generous. Waves 2-3 build the depth that a future Pro
tier can gate via `required_plan` without touching the core tracker, keeping
moat #1 intact.

---

## 5. Sources

- Parqet: [parqet.com/en](https://parqet.com/en), [pricing](https://parqet.com/en/pricing), [etf.capital review 2026](https://etf.capital/parqet-app/)
- getquin alternatives/comparison: [donkycapital.com](https://www.donkycapital.com/en/compare/best-getquin-alternatives-portfolio-tracker-2026), [finanzrocker.net Depotverwaltung Vergleich](https://finanzrocker.net/depotverwaltung-software/)
- Finanzfluss Copilot: [finanzfluss.de/copilot](https://www.finanzfluss.de/copilot/), [Preise](https://www.finanzfluss.de/copilot/preise/), [reisetopia guide 2026](https://reisetopia.de/guides/finanzen/finanzfluss-copilot/)
- Portfolio Performance: [portfolio-performance.info](https://www.portfolio-performance.info/), [Vorabpauschale forum threads](https://forum.portfolio-performance.info/t/vorabpauschale-in-pp-erfassen/4390)
- DivvyDiary: [divvydiary.com](https://divvydiary.com/en/), [Aktiengram Erfahrungsbericht](https://aktiengram.de/divvydiary-erfahrungsbericht/)
- Sharesight / Snowball: [stockanalysis.com best trackers](https://stockanalysis.com/article/best-stock-portfolio-tracker/), [snowball-analytics.com](https://snowball-analytics.com/), [Capitally comparison](https://www.mycapitally.com/blog/best-portfolio-tracker-for-the-modern-diy-investor)
- Broker sync landscape (DACH): [wealthapi.eu](https://wealthapi.eu/en/tool-portfoliotracker/), [Tukhe European tracker comparison](https://tukhe.io/en/blog/best-portfolio-tracker-european-investors-compared)
- Tracker roundups: [finanzwissen.de Portfolio-Apps](https://finanzwissen.de/vergleich/portfolio-apps/), [hermoney.de Portfolio-Tracker](https://www.hermoney.de/boerse-geldanlage/geld-alltag/portfolio-tracker-apps/), [Benzinga best trackers 2026](https://www.benzinga.com/money/best-portfolio-tracker)
