# ROADMAP

Where FinTrack stands today, how it compares to the four tools German-speaking
retail investors actually use — Portfolio Performance, Finanzfluss Copilot,
Parqet, getquin — and what to build next. Last reviewed: 2026-07-05.

---

## 1. Current state

### What the app does today

| Area | Status |
| --- | --- |
| Asset classes | ETF, stock, crypto, cash (incl. cash-specific UX: balance chart, no phantom prices) |
| Portfolios | Up to 20 portfolios, guest mode (localStorage) + registered mode (Supabase), offline-capable PWA with mutation queue |
| Performance | Net-worth series, TWR, money-weighted XIRR, per-period returns, realized/unrealized P&L, top movers |
| Risk | Volatility, drawdown, beta/alpha vs. benchmark, risk view on `/analysis` |
| Benchmarks | MSCI World, FTSE All-World, DAX, S&P 500, STOXX 600 overlay on the performance chart |
| Dividends | Real payout history per holding (Yahoo), FX-converted, shown on asset detail |
| Allocation | Pie breakdowns by investment / class / currency / country / region / sector / volatility, DB-backed classifications |
| ETF X-ray | Look-through to constituent stocks (`instrument_constituents`), overlap/exposure analysis |
| Rebalancing | Target-allocation view with deviation |
| Simulation | Monte Carlo with measured μ/σ + correlations (Cholesky), off-thread worker |
| Import | CSV for known German brokers + generic header-driven parser, fingerprint dedupe, field-level merge on conflicts |
| Export | Full CSV + JSON, one click, no lock-in |
| Sharing | Read-only share links (server-only insert, size + rate limits) |
| Prices | Yahoo by ISIN (currency-matched listing) → Stooq → deterministic synthetic fallback, CoinGecko for crypto, Frankfurter FX |
| UX | EN + DE, privacy mode (blur values), mobile-dense dashboard, estimated-data badge, feature flags in DB |

### Where FinTrack is already ahead

- **No paywall, no account required.** Parqet caps the free tier at 10
  transactions; getquin Premium is €89.99/yr; Copilot PLUS is €8.99/mo. Guest
  mode gives the full feature set with zero signup.
- **Privacy by architecture, not policy.** All market-data calls are
  server-proxied, no analytics, essential-only storage — and the privacy
  policy makes verifiable claims about the code. Copilot/getquin require bank
  connections or accounts for their headline features.
- **Monte Carlo with measured parameters** — none of the four ship a
  portfolio-calibrated simulation.
- **Offline-first PWA with sync queue** — only Portfolio Performance (desktop
  file) works offline at all.
- **Honest data labeling** — the estimated badge distinguishes real from
  synthetic series; competitors silently interpolate.

---

## 2. Competitor snapshot

**Portfolio Performance** (open source, desktop + companion app) — the
correctness gold standard: TTWROR + IRR everywhere, per-transaction fees *and
taxes*, free-form multi-level taxonomies with target allocation and
rebalancing against them, PDF import for dozens of broker statements, open XML
file format. Weaknesses: steep learning curve, no web app, manual data flow.

**Finanzfluss Copilot** (freemium, €8.99/mo PLUS) — whole-net-worth angle:
automated connections to 350+ banks/brokers, Tagesgeld/Festgeld, real estate,
commodities, "other assets", plus a Haushaltsbuch (budgeting). Analysis by
class/position/region/sector/currency with over/underweight callouts.
Dividend dashboard with personal yield. Weakness: analysis depth is behind a
subscription; no self-hosting; data lives with a third party.

**Parqet** (freemium, €5.99–9.99/mo) — polish + breadth: 50+ broker imports,
dividend dashboard/forecast/calendar with personal yield, tax dashboard,
X-ray, benchmarks incl. community comparison, news feed, widgets, and
recently "ask Claude/ChatGPT about your portfolio" (MCP-style integration).
Weakness: 10-transaction free tier, closed.

**getquin** (freemium, €89.99/yr) — community-first: 30,000+ institution
connections, anonymized shared portfolios, discussion spaces, strong dividend
calendar + long-range forecasting, DeepDive X-ray. Weakness: social features
are noise for pure trackers; full analysis is paid.

### Feature gap matrix

| Feature | PP | Copilot | Parqet | getquin | FinTrack |
| --- | :-: | :-: | :-: | :-: | :-: |
| Dividend **dashboard/calendar/forecast** | ◐ | ✓ | ✓ | ✓ | ✓ (since 2026-07) |
| Savings plans / recurring buys | ✓ | ✓ | ✓ | ✓ | ✓ (since 2026-07) |
| PDF statement import | ✓ | ✓ | ◐ | ◐ | ✗ (CSV only) |
| Per-transaction taxes | ✓ | ◐ | ✓ | ◐ | ✓ (since 2026-07) |
| Tax report / dashboard (DE) | ◐ | ✗ | ✓ | ◐ | ◐ (annual report; no Vorabpauschale yet) |
| Tagesgeld/Festgeld with interest | ◐ | ✓ | ✓ | ◐ | ◐ (plain cash) |
| More asset classes (bonds, gold, real estate, "other") | ✓ | ✓ | ✓ | ✓ | ✗ |
| Custom taxonomies + rebalance against them | ✓ | ✗ | ◐ | ✗ | ◐ (tags exist, no targets) |
| Watchlist | ✓ | ✗ | ✓ | ✓ | ✓ (since 2026-07) |
| Custom benchmark (any ISIN) | ✓ | ✗ | ✓ | ◐ | ✗ (5 fixed) |
| Bank/broker API sync | ✗ | ✓ | ◐ | ✓ | ✗ |
| News per holding | ✗ | ✗ | ✓ | ✓ | ✗ |
| Community / portfolio discovery | ✗ | ✗ | ◐ | ✓ | ◐ (share links) |
| AI portfolio Q&A | ✗ | ✗ | ✓ | ◐ | ✗ |

---

## 3. Roadmap

Ordered by (value to a German/European self-directed investor) ÷ (effort given
the existing architecture). Each item names the seam it builds on. Everything
ships behind a `feature_flags` row, EN + DE, both `schema.sql` and a
migration.

### Now — close the table-stakes gaps

> **✅ Shipped 2026-07-06** — all four items below are implemented: `/dividends`
> dashboard, savings plans with review-before-book, `tax` on transactions +
> annual tax report on `/analysis`, and the dashboard watchlist. Each is
> behind its own `feature_flags` row (`dividends`, `savingsPlans`,
> `taxReport`, `watchlist`), migrations 0036–0039.

1. **Dividend dashboard (`/dividends`)** — the single most visible gap; all
   four competitors have one. The data already flows through
   `/api/dividends`; what's missing is aggregation: income by month/year
   (bars), personal dividend yield and yield-on-cost, per-holding breakdown,
   and a **forecast/calendar** (project next 12 months from trailing payouts;
   upgrade later to announced ex-dates from Yahoo's calendar endpoint via
   `lib/server/yahoo.ts`). Pure aggregation lives in `lib/finance/dividends.ts`.

2. **Savings plans (Sparpläne)** — recurring buy rules (amount, interval,
   start date) that materialize as ordinary transactions, so `portfolio.ts`
   stays untouched. Table stakes in the German market and the natural partner
   of CSV import for Trade-Republic/Scalable users. New `savings_plans` table
   + `DataStore` methods (both stores); a due-date check on load creates
   pending transactions with a confirm step (destructive-action rule doesn't
   apply, but silent money movements deserve a review dialog anyway).

3. **Taxes on transactions + annual tax report** — add `tax` next to `fee` on
   `Transaction` (schema + both stores + CSV parsers, which already see tax
   columns in German broker exports and currently drop them). Then extend
   `lib/finance/trades.ts` (`realizedByMonth` → per-tax-year realized gains,
   dividends, fees, taxes) into a printable **Steuerreport**: Freistellungs-
   auftrag tracker and Vorabpauschale estimate are the Parqet-level follow-ups.

4. **Watchlist** — cheapest differentiating win: catalog search, quotes, and
   charts all exist; a watchlist is an asset list with no transactions. New
   `watchlist` table + localStorage twin behind the `DataStore` seam, surfaced
   on the dashboard below holdings.

### Next — depth that earns trust

5. **Interest-bearing cash (Tagesgeld/Festgeld)** — Copilot's wedge feature.
   Extend CASH assets with an optional interest rate + compounding rule;
   accrue as synthetic interest transactions (clearly labeled, confirmable).
   The cash-specific UX from round 8 (balance chart, no unit price) is the
   foundation.

6. **Target allocations on tags → rebalancing v2** — Portfolio Performance's
   taxonomies are its most-loved feature and FinTrack already has free-form
   tags (`lib/tags/`). Let users pin a target % per tag (and per asset class),
   show drift on `/rebalancing`, and add an **"invest new money"** mode that
   answers "I have €500 — what do I buy to converge?" instead of suggesting
   sells (tax-friendlier, and what savings-plan investors actually do).

7. **Custom benchmarks** — any catalog instrument (by ISIN) as benchmark, not
   just the five hardcoded ones in `lib/finance/benchmarks.ts`. The compare
   machinery (`use-benchmark-compare.ts`) already normalizes series; this is
   mostly a picker that searches the catalog + `/api/lookup`.

8. **PDF import** — Portfolio Performance's moat and the top ask of anyone
   migrating from it. Start narrow: parse the two or three most common broker
   PDFs (Trade Republic, Scalable, ING) server-side into the existing
   `ImportedRow` shape so reconciliation, fingerprints, and the merge UI are
   reused unchanged. A "import from Portfolio Performance (CSV/XML)" path is
   the cheaper sibling and pulls its users directly.

9. **Broader asset classes** — `OTHER` (manual valuation entries: real
   estate, collectibles) and `COMMODITY` (gold via existing price plumbing)
   extend `AssetType` without new pricing infrastructure: manual-valuation
   assets are a user-entered price series, which the synthetic provider seam
   (`PriceProvider`) was built to absorb. Bonds only when demand shows —
   pricing/YTM is a rabbit hole.

### Later — strategic bets (decide deliberately)

10. **AI portfolio Q&A / MCP endpoint** — Parqet just shipped "ask Claude
    about your portfolio". FinTrack's angle: the finance core is pure and the
    export already serializes everything, so a read-only MCP server (or a
    "copy portfolio context" button) is small — and privacy-consistent
    because the *user* hands data to the model, the app still sends nothing.

11. **Community-lite** — getquin's moat is out of reach and off-brand, but a
    public gallery of *opt-in* shared portfolios (`/shared` already renders
    them) plus "compare my performance vs. shared portfolio X" reuses the
    benchmark-compare machinery.

12. **News per holding** — server-proxied (CSP forbids client-side external
    fetches by design) headline feed on asset detail. Needs a sustainable
    source; Yahoo's unofficial endpoints are already rate-limit-fragile, so
    don't hang a headline feature on them.

13. **Bank/broker API sync** — the biggest gap vs. Copilot/getquin and the
    most expensive: FinAPI/Plaid-class aggregators cost real money and
    contradict "your data never leaves your control". If ever, do it as an
    explicitly opt-in, clearly-labeled mode — and only after import (CSV/PDF)
    is so good that sync is a convenience, not a necessity.

### Non-goals

- **Budgeting/Haushaltsbuch** (Copilot) — different product; stay a portfolio
  tracker.
- **Native apps/widgets** — the PWA is the mobile strategy; invest in PWA
  polish (install prompt, icon shortcuts) instead.
- **Hardcoded reference data, env-var feature flags, client-side external
  fetches** — architectural decisions already made; every roadmap item above
  respects the store seam, DB-backed catalog/flags, and server-proxied data
  flows.

---

## 4. References

- Portfolio Performance: https://www.portfolio-performance.info/
- Finanzfluss Copilot: https://www.finanzfluss.de/copilot/ (pricing: /copilot/preise/)
- Parqet: https://parqet.com/en (dividend tracker: /en/dividend-tracker)
- getquin: https://www.getquin.com/ (dividend tracker: /dividend-tracker/)
