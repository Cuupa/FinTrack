// Core domain types shared across the app and both storage backends.

import type { LlmProviderId } from "./llm/types";

export type AssetType = "ETF" | "STOCK" | "CRYPTO" | "COMMODITY" | "CASH" | "OTHER";
// BOOKING is a cost-free crediting of shares — e.g. an
// employer's vermögenswirksame Leistung or a gift. It adds shares at ZERO cost
// basis, so their full current value counts as profit. INTEREST is interest
// credited to a cash position — also zero cost basis, and counts as return.
// SPLIT is a stock split / corporate action: its `quantity` field holds the
// ratio (new shares per old share — 2 for a 2-for-1 forward split, 0.5 for a
// 1-for-2 reverse split), and `price`/`fee`/`tax` are always 0. It multiplies
// the shares held immediately before it by the ratio and divides the running
// average cost per share by the ratio, so total cost basis (shares ×
// avgCost) is unchanged. It is order-dependent: shares bought after the
// split are already recorded in post-split units by the user and must not be
// multiplied again.
export type TransactionType = "BUY" | "SELL" | "BOOKING" | "INTEREST" | "SPLIT";

export const ASSET_TYPES: AssetType[] = ["ETF", "STOCK", "CRYPTO", "COMMODITY", "CASH", "OTHER"];

/** Per-user configuration (PRD: `profiles`). */
export interface Profile {
  /** ISO 4217 base currency for all displayed values, e.g. "EUR". */
  currency: string;
  /** Display name / nickname, shown in the UI and on shared portfolios. */
  name: string | null;
  /** Preferred UI locale ("en" | "de"); null = use the device/last choice. */
  locale: string | null;
  /** Explicit light/dark choice; null = follow the device/OS preference. */
  theme: "light" | "dark" | null;
  /** Sparerpauschbetrag: tax-free capital income allowance, base currency. */
  taxAllowance: number;
  /** Kirchensteuer rate applied on top of Abgeltungsteuer: 0 | 0.08 | 0.09. */
  churchTaxRate: number;
  /** Apply the 30% Teilfreistellung to equity fund (ETF) gains/dividends. */
  taxTeilfreistellung: boolean;
  /** Manually entered Vorabpauschale per year ("2025" -> amount, base currency); can't be computed from transaction data. */
  taxVorabpauschale: Record<string, number>;
  /** Manual override of the tax withheld by the broker per year; replaces the transaction-derived sum when set. */
  taxWithheldOverride: Record<string, number>;
  /** ISO datetime the guided tour was completed or skipped; null = never shown. */
  tourDoneAt: string | null;
  /** Per-page guided tours (round 21+): tourId -> ISO datetime completed/skipped.
   *  Separate from `tourDoneAt` (the original dashboard tour) so each page tour
   *  (risk, rebalancing, simulation, assetTags) tracks its own completion. */
  toursDone: Record<string, string>;
  /** Persisted rebalancing plan (COMPETITION.md F10) — target weights, the
   *  freely-added custom positions, and the mode. Survives reload so the
   *  /rebalancing grid is no longer forgotten. Empty default = no plan yet. */
  rebalanceTargets: RebalancePlan;
}

/** A saved rebalancing plan, persisted on the profile and rehydrated by
 *  /rebalancing. `weights` maps a row id (a held asset's id, or a custom
 *  position's id) to its target weight in percent. */
export interface RebalancePlan {
  mode: "trade" | "buyOnly";
  weights: Record<string, number>;
  custom: { id: string; name: string }[];
}

export const EMPTY_REBALANCE_PLAN: RebalancePlan = { mode: "trade", weights: {}, custom: [] };

/**
 * An asset the user holds. Merges the PRD `assets` master-data row with the
 * per-user `user_assets` mapping (`notes`) — every asset row is owned by the
 * current user/guest.
 *
 * Securities are identified by ISIN/WKN. `symbol` is only used for assets that
 * have no ISIN/WKN (crypto, e.g. "BTC") and as a last-resort label.
 */
export interface Asset {
  id: string;
  isin: string | null;
  wkn: string | null;
  symbol: string | null;
  name: string;
  type: AssetType;
  /** Native trading currency (null = portfolio base currency). */
  currency: string | null;
  notes: string | null;
  /**
   * CASH only: annual nominal interest rate in PERCENT (e.g. 3.5 = 3.5% p.a.),
   * or null/undefined for a non-interest-bearing balance. Interest accrues at
   * `interestFrequency` and is booked as INTEREST transactions after an
   * explicit review (see `lib/finance/cash-interest.ts`). Optional so existing
   * Asset literals stay valid.
   */
  interestRate?: number | null;
  /** CASH only: how often interest is credited/compounded. Null/undefined when
   *  no rate is set. */
  interestFrequency?: InterestFrequency | null;
}

/**
 * One user-entered valuation of an OTHER (manual-valuation) asset on a date:
 * real estate, collectibles, unlisted holdings that no market data source can
 * price. These points form the asset's price series through the PriceProvider
 * seam (`lib/finance/manual-valuation.ts` → `lib/finance/prices.ts`). `value`
 * is the per-unit price in the asset's native currency (an OTHER asset is
 * normally held as a single unit, so per-unit == total).
 */
export interface ValuationPoint {
  assetId: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Per-unit value in the asset's native currency. */
  value: number;
}

/** How often a cash position's interest is credited and compounded. */
export type InterestFrequency = "MONTHLY" | "QUARTERLY" | "ANNUAL";

export const INTEREST_FREQUENCIES: InterestFrequency[] = ["MONTHLY", "QUARTERLY", "ANNUAL"];

/** The identifier fields shared by assets and watchlist items. */
export type InstrumentRef = Pick<Asset, "isin" | "wkn" | "symbol" | "name">;

/**
 * Stable key used to look up prices for an asset. Prefers ISIN, then WKN, then
 * symbol, then name — so two assets that share an ISIN share a price series.
 */
export function assetPriceKey(asset: InstrumentRef): string {
  return (asset.isin || asset.wkn || asset.symbol || asset.name || "").toUpperCase();
}

/** Human-facing identifier shown in tables and headers. */
export function assetIdentifier(asset: InstrumentRef): string {
  if (asset.wkn && asset.isin) return `${asset.wkn} · ${asset.isin}`;
  return asset.isin || asset.wkn || asset.symbol || "—";
}

/**
 * An instrument the user watches without holding it. Shares the asset's
 * master-data shape (so price lookup and display helpers work unchanged) but
 * never carries transactions.
 */
export interface WatchlistItem {
  id: string;
  isin: string | null;
  wkn: string | null;
  symbol: string | null;
  name: string;
  type: AssetType;
  /** Native trading currency (null = portfolio base currency). */
  currency: string | null;
}

/**
 * A named portfolio. A user can hold several; transactions belong to one.
 * The optional fee model prefills (never forces) new transaction/savings-plan
 * fee inputs — see `lib/finance/fees.ts`.
 */
export interface Portfolio {
  id: string;
  name: string;
  /** Flat fee per buy/sell execution, in the base currency. Default 0. */
  feeOrderFlat?: number;
  /** Order volume at/above which the order fee is waived. Null/undefined =
   *  the fee always applies. */
  feeOrderFreeFrom?: number | null;
  /** Fee per savings-plan execution, in the base currency. Default 0. */
  feeSavingsPlan?: number;
  /** Registered Freistellungsauftrag at this broker, base currency. Null/undefined
   *  = none registered here; the global `Profile.taxAllowance` is the fallback
   *  used until at least one portfolio has this set (see `lib/finance/tax.ts`). */
  taxAllowance?: number | null;
}

export const MAX_PORTFOLIOS = 20;
export const DEFAULT_PORTFOLIO_ID = "default";

/** A buy or sell event (PRD: `transactions`). */
export interface Transaction {
  id: string;
  assetId: string;
  /** The portfolio this transaction belongs to. */
  portfolioId: string;
  type: TransactionType;
  /** Number of shares/units (always positive; direction comes from `type`). */
  quantity: number;
  /** Price per unit in the base currency. */
  price: number;
  /** Transaction fee in the base currency. */
  fee: number;
  /**
   * Tax withheld on this transaction in the base currency (Abgeltungsteuer on
   * sells, transaction tax on some buys). Mirrors `fee` in the cash math: a
   * buy tax raises the cost basis, a sell tax reduces the proceeds.
   */
  tax: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
}

export type SavingsPlanInterval = "WEEKLY" | "MONTHLY" | "QUARTERLY";

export const SAVINGS_PLAN_INTERVALS: SavingsPlanInterval[] = [
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
];

/**
 * A recurring buy rule (Sparplan). Plans never change the finance core: due
 * occurrences are materialized as ordinary BUY transactions after an explicit
 * user review, and `lastRunDate` advances so each occurrence happens once.
 */
export interface SavingsPlan {
  id: string;
  assetId: string;
  portfolioId: string;
  /** Amount invested per execution, in the asset's currency. */
  amount: number;
  interval: SavingsPlanInterval;
  /**
   * How due executions are booked: BUY spends the user's own money (cost
   * basis as usual); BOOKING is a free external inflow, e.g. employer-paid
   * vermögenswirksame Leistungen, credited at zero cost. Older stored plans
   * lack the field — read as BUY.
   */
  bookingType?: "BUY" | "BOOKING";
  /** First execution day (YYYY-MM-DD). */
  startDate: string;
  /** Paused plans accrue no new occurrences. */
  active: boolean;
  /** Day of the last materialized occurrence (YYYY-MM-DD), or null. */
  lastRunDate: string | null;
}

/**
 * A user-defined key-value tag group (e.g. "Strategie"), for the Analysis
 * "Custom" distribution and the asset page's tag badges.
 */
export interface TagGroup {
  id: string;
  name: string;
}

/** assetId -> groupId -> values. */
export type TagAssignments = Record<string, Record<string, string[]>>;

/**
 * The user's BYO LLM assistant config (provider, model, API key). Rides the
 * DataStore seam like watchlist/savings plans/tags (round-22 tags precedent,
 * owner override of the earlier "localStorage only" decision): DB-persisted
 * for registered users (`llm_settings`), localStorage-backed (inside the
 * guest blob) for guests.
 */
export interface LlmConfig {
  provider: LlmProviderId;
  model: string;
  key: string;
}

/** The complete persisted state for one user (or guest session). */
export interface PortfolioData {
  profile: Profile;
  portfolios: Portfolio[];
  assets: Asset[];
  transactions: Transaction[];
  watchlist: WatchlistItem[];
  savingsPlans: SavingsPlan[];
  tagGroups: TagGroup[];
  tagAssignments: TagAssignments;
  /** Manual valuation points for OTHER assets (see `ValuationPoint`). */
  valuationPoints: ValuationPoint[];
  /** null = no key configured. */
  llmConfig: LlmConfig | null;
}

export const DEFAULT_PROFILE: Profile = {
  currency: "EUR",
  name: null,
  locale: null,
  theme: null,
  taxAllowance: 1000,
  churchTaxRate: 0,
  taxTeilfreistellung: false,
  taxVorabpauschale: {},
  taxWithheldOverride: {},
  tourDoneAt: null,
  toursDone: {},
  rebalanceTargets: { mode: "trade", weights: {}, custom: [] },
};

export function emptyPortfolio(): PortfolioData {
  return {
    profile: { ...DEFAULT_PROFILE },
    portfolios: [{ id: DEFAULT_PORTFOLIO_ID, name: "Main" }],
    assets: [],
    transactions: [],
    watchlist: [],
    savingsPlans: [],
    tagGroups: [],
    tagAssignments: {},
    valuationPoints: [],
    llmConfig: null,
  };
}
