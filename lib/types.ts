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
  /** CASH only: which calendar day interest posts on. Null/undefined keeps the
   *  legacy behaviour (the day-of-month of the asset's first transaction,
   *  clamped to shorter months). */
  interestPostDay?: InterestPostDay | null;
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

/**
 * A balance account (ROADMAP item #1, flag `accounts`): checking/savings/credit/
 * loan/mortgage/other. Distinct from a derived-from-trades holding — it's a
 * balance the user sets, not a position priced from a market. Liabilities carry
 * `isLiability=true` and subtract from net worth; this is the one entity that
 * can push net worth below zero.
 */
export type AccountKind =
  | "checking"
  | "savings"
  | "credit"
  | "loan"
  | "mortgage"
  | "other_asset"
  | "other_liability";

export const ACCOUNT_KINDS: AccountKind[] = [
  "checking",
  "savings",
  "credit",
  "loan",
  "mortgage",
  "other_asset",
  "other_liability",
];

/** The account kinds that are liabilities by nature (used to default the
 *  `isLiability` sign when the user picks a kind). */
export const LIABILITY_KINDS: AccountKind[] = ["credit", "loan", "mortgage", "other_liability"];

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Native currency (null = the profile base currency). */
  currency: string | null;
  /** True = the balance is money owed and subtracts from net worth. */
  isLiability: boolean;
  /** Balance at `openedOn`, in the account's native currency, as a positive
   *  magnitude (the sign comes from `isLiability`). Acts as the implicit first
   *  balance point of the carry-forward series. */
  openingBalance: number;
  /** YYYY-MM-DD the account was opened; before this it contributes 0. */
  openedOn: string;
  /** Annual interest rate as a percent (e.g. 4.5 = 4.5%), ROADMAP item #9
   *  (flag `debtPayoff`). Optional/nullable -- only entered once the user
   *  wants an amortisation schedule for a liability account. */
  interestRate?: number | null;
  /** Minimum monthly payment, native currency, ROADMAP item #9. Optional/
   *  nullable like `interestRate`. */
  minPayment?: number | null;
  /** End of the fixed-rate period (Zinsbindung), YYYY-MM-DD. Up to this date
   *  `interestRate` applies; from the day after, `followUpRate` does. Setting
   *  a follow-up rate must never mean rewriting the rate in force today --
   *  that is the whole reason these are two separate fields, not one. */
  rateFixedUntil?: string | null;
  /** Assumed annual rate (percent) after `rateFixedUntil`. Null = keep
   *  `interestRate` for the whole term. */
  followUpRate?: number | null;
}

/**
 * One dated balance reading for an {@link Account} (mirrors {@link ValuationPoint}
 * for OTHER assets): a step/carry-forward series where the balance on a date is
 * the last reading at or before it. `balance` is the native-currency magnitude;
 * the net-worth sign is applied from the account's `isLiability`.
 */
export interface AccountBalance {
  accountId: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Native-currency balance magnitude on this date. */
  balance: number;
}

/**
 * A user-defined spending category (ROADMAP item #2, flag `spending`): a flat
 * two-level taxonomy (`groupName` + `name`, e.g. "Housing" / "Rent"). Unlike
 * `TagGroup`/asset tags, a transaction carries exactly one category, so there
 * is no separate group entity or many-valued junction table.
 */
export interface SpendingCategory {
  id: string;
  groupName: string;
  name: string;
  /**
   * Tax-deductible expense category (ROADMAP item #11, flag `taxPack`) --
   * feeds the year-end tax pack's deductible-expenses summary. Optional:
   * existing categories predate this field and default to "not deductible".
   */
  taxDeductible?: boolean;
}

/**
 * An expense/income transaction against an {@link Account} (ROADMAP item #2,
 * flag `spending`). `amount` is signed in the account's native currency:
 * income positive, expense negative. `categoryId` is nullable (uncategorised
 * spend still books). `recurringId` holds the {@link Contract} that posted
 * this booking, and is null for anything the user entered or imported
 * themselves — `detectRecurringCandidates` uses it to skip charges that are
 * already registered.
 */
export interface SpendingTransaction {
  id: string;
  accountId: string;
  categoryId: string | null;
  /** YYYY-MM-DD. */
  date: string;
  /** Signed, native currency: income positive, expense negative. */
  amount: number;
  payee: string;
  note: string | null;
  recurringId: string | null;
  /**
   * Set when this booking moved money to another {@link Account} of the user's
   * own rather than spending it: a loan instalment, or a premium paid into a
   * wealth-building policy (Riester, kapitalbildende Lebensversicherung).
   *
   * Such a booking is NOT income and NOT expense — net worth is unchanged at
   * the moment of payment, only its composition shifts — so every aggregation
   * in `lib/finance/spending.ts` skips it. Without this, a Riester premium
   * booked by a contract would read as pure consumption and the spending
   * picture would be wrong by the full premium every month.
   *
   * It moves BOTH accounts' balances: `lib/finance/account-ledger.ts` derives
   * a movement on each side, and `lib/finance/accounts.ts` carries them
   * forward from the most recent reading. That is what makes a loan instalment
   * actually retire debt. (Before the ledger rework a balance was the opening
   * value plus the readings the user typed and nothing else, so a contract
   * could post a 450 EUR instalment every month while the loan never moved.)
   * A dated reading still wins outright and re-anchors the chain, so a
   * movement can never be counted twice.
   */
  transferAccountId?: string | null;
  /**
   * The {@link PlannedCashflow} whose due occurrence this booking materialised;
   * null for anything entered, imported, or posted by a contract.
   *
   * A field of its own rather than reusing `recurringId`: that one is a foreign
   * key to `contracts`, and a planned cashflow lives in its own table, so a
   * single nullable column cannot reference both.
   * `detectRecurringCandidates` skips these rows for the same reason it skips
   * `recurringId` rows -- the charge is already registered somewhere.
   */
  plannedId?: string | null;
}

/**
 * A monthly spending cap for one {@link SpendingCategory} (ROADMAP item #4,
 * flag `budgets`) -- the "category caps + flow" philosophy, not YNAB-style
 * envelopes. `amount` is in the profile's base currency: category totals are
 * already converted to base before aggregation (see `toBaseCurrency` in
 * `lib/finance/spending.ts`), so a cap needs no currency of its own. At most
 * one budget exists per category.
 */
export interface Budget {
  id: string;
  categoryId: string;
  /** Monthly cap, in the profile's base currency. */
  amount: number;
}

/**
 * A household (ROADMAP item #13, flag `household`): a group of registered
 * users who share read/write access to each other's financial data. v1 caps
 * membership at one household per user (enforced in the DB, see migration
 * 0091_households.sql) -- there is no multi-household selection UI.
 */
export interface Household {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export type HouseholdRole = "owner" | "member";

export interface HouseholdMember {
  id: string;
  householdId: string;
  userId: string;
  role: HouseholdRole;
  joinedAt: string;
}

export type HouseholdInviteStatus = "pending" | "accepted" | "declined" | "revoked";

export interface HouseholdInvite {
  id: string;
  householdId: string;
  email: string;
  invitedBy: string;
  role: HouseholdRole;
  status: HouseholdInviteStatus;
  createdAt: string;
}

/** How often a contract charges (ROADMAP item #5, flag `contracts`). */
export type ContractInterval = "MONTHLY" | "QUARTERLY" | "ANNUAL";

export const CONTRACT_INTERVALS: ContractInterval[] = ["MONTHLY", "QUARTERLY", "ANNUAL"];

/**
 * A named recurring commitment (subscription, insurance, rent) tracked
 * independently of any one spending transaction (ROADMAP item #5, flag
 * `contracts`). `amount` is the per-interval charge, in the profile's base
 * currency (same convention as `Budget.amount`). `renewalDate` +
 * `cancellationNoticeDays` are both optional -- filled in once known, so the
 * UI can flag an approaching cancellation deadline; a contract with neither
 * is still a valid register entry. `categoryId` reuses the spending
 * taxonomy and is nullable (mirrors `SpendingTransaction.categoryId` -- set
 * null, not cascade-deleted, when its category goes away).
 */
export interface Contract {
  id: string;
  name: string;
  /** Per-interval charge, in the profile's base currency. */
  amount: number;
  interval: ContractInterval;
  /** YYYY-MM-DD, or null if unknown. */
  renewalDate: string | null;
  /** Notice period required before `renewalDate` to cancel, or null. */
  cancellationNoticeDays: number | null;
  categoryId: string | null;
  /** Insurance type, ROADMAP item #10 (flag `insurance`) -- insurance rows
   *  are typed contracts on this same entity rather than a separate table.
   *  Null/absent means this is an ordinary (non-insurance) contract. */
  insuranceType?: InsuranceType | null;
  /** Sum insured (coverage amount), profile base currency, ROADMAP item #10.
   *  Only meaningful alongside `insuranceType`. */
  sumInsured?: number | null;
  /** Account the recurring charge is posted against. Null (the default) keeps
   *  the contract a register entry only: it never books anything, which is how
   *  every contract behaved before booking existed. */
  accountId?: string | null;
  /** First date a booking is due. Anchors the occurrence series exactly like
   *  `SavingsPlan.startDate`, so the schedule stays derivable rather than
   *  stored per occurrence. Null whenever `accountId` is null. */
  bookingStartDate?: string | null;
  /** Last date a booking was actually posted, or null if none yet. Advanced
   *  only after the user confirms the due bookings, mirroring
   *  `SavingsPlan.lastRunDate`. */
  lastBookedDate?: string | null;
  /**
   * Where the money goes when this contract is not consumption: the loan being
   * repaid, or the policy being paid into. Set, the contract's bookings carry
   * `SpendingTransaction.transferAccountId` and stop counting as expense.
   *
   * This is what separates "Netflix" from "Riester" and from an
   * Annuitätendarlehen — all three are recurring charges, but only the first
   * one is money spent.
   */
  targetAccountId?: string | null;
}

/** Insurance types tracked on a {@link Contract} (ROADMAP item #10, flag
 *  `insurance`). Covers the core DACH household coverage set used by
 *  `lib/finance/insurance.ts`'s coverage-gap prompts, plus a few common
 *  extras and a catch-all. */
export type InsuranceType =
  | "liability"
  | "health"
  | "household"
  | "legal"
  | "disability"
  | "life"
  | "vehicle"
  | "other";

export const INSURANCE_TYPES: InsuranceType[] = [
  "liability",
  "health",
  "household",
  "legal",
  "disability",
  "life",
  "vehicle",
  "other",
];

/** How often a planned cashflow recurs (flag `plannedCashflow`). `ONCE` is a
 *  single dated entry, which is what a {@link Contract} cannot express. */
export type PlannedInterval = "ONCE" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";

export const PLANNED_INTERVALS: PlannedInterval[] = [
  "ONCE",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "ANNUAL",
];

/**
 * A planned income or expense (flag `plannedCashflow`): the salary landing at
 * the end of the month, a bonus, a tax refund, or a one-off expense the user
 * already knows about (a holiday, a new washing machine).
 *
 * A sibling of {@link Contract}, deliberately not an extension of it. A
 * contract is a running commitment with a renewal date and a cancellation
 * notice, it is always money going out, and `detectRecurringCandidates` is
 * built for expenses only. Planned cashflows are the other half: expected
 * money, in either direction, including the single dated entry a contract
 * cannot express.
 *
 * `amount` follows {@link SpendingTransaction} rather than `Contract`/`Budget`:
 * signed (income positive, expense negative) and in the ACCOUNT's native
 * currency, since booking a due occurrence is then a straight copy and
 * `incomeExpenseSplit`/`isTransfer` apply unchanged. `accountId` is required
 * for the same reason -- an expected cashflow always lands in a concrete
 * account, which is also where its currency comes from.
 */
export interface PlannedCashflow {
  id: string;
  name: string;
  /** The account the money lands in or leaves from (source of the currency). */
  accountId: string;
  /** Nullable like `SpendingTransaction.categoryId`; set null on category delete. */
  categoryId: string | null;
  /** Signed, account's native currency: income positive, expense negative. */
  amount: number;
  interval: PlannedInterval;
  /** YYYY-MM-DD of the first occurrence; anchors the series exactly like
   *  `SavingsPlan.startDate`/`Contract.bookingStartDate`, so the schedule stays
   *  derivable instead of stored per occurrence. */
  startDate: string;
  /** YYYY-MM-DD of the last occurrence (inclusive), or null for open-ended.
   *  Fixed-term income like parental allowance ends after twelve payments. */
  endDate: string | null;
  /** Last date actually booked into the ledger, or null if none yet. Advanced
   *  only after the user confirms the due bookings, like `Contract.lastBookedDate`. */
  lastBookedDate: string | null;
  /** Set when the cashflow moves money to another account of the user's own (a
   *  standing transfer into savings): its bookings then carry
   *  `SpendingTransaction.transferAccountId` and count as neither income nor
   *  expense, same rule as a contract's transfer bookings. */
  transferAccountId: string | null;
  note: string | null;
}

/**
 * A named savings goal (ROADMAP item #6, flag `goals`) -- a target amount,
 * optionally by a target date, whose progress either mirrors a linked
 * {@link Account}'s current balance or is entered manually. `targetAmount`
 * and `manualCurrentAmount` are both in the profile's base currency (same
 * convention as `Budget.amount`/`Contract.amount`). `linkedAccountId` is
 * nullable and set null (not cascade-deleted) when its account goes away --
 * mirrors `Contract.categoryId`'s "still means something" precedent -- the
 * goal simply falls back to manual tracking.
 *
 * A goal is either atomic ("emergency fund") or composite ("trip to the USA"
 * = flight + hotel + taxi). Composition is expressed by the SUB-goals
 * pointing at their parent via `parentGoalId`, so an atomic goal needs no
 * extra fields at all. A parent's target and progress are then DERIVED from
 * its children (`goalTotals` in lib/finance/goals.ts) -- its own
 * `targetAmount` and tracking fields stop being used the moment it has one.
 */
export interface Goal {
  id: string;
  name: string;
  /** Target amount, in the profile's base currency. */
  targetAmount: number;
  /** YYYY-MM-DD, or null if open-ended. */
  targetDate: string | null;
  /** Optional link to an Account whose current balance IS the goal's
   *  progress. Null means progress is tracked manually. */
  linkedAccountId: string | null;
  /** Manually-entered current progress, base currency. Only used/shown when
   *  the goal tracks neither an account nor the depot. Null = 0 so far. */
  manualCurrentAmount: number | null;
  /** Progress mirrors the depot's current market value instead of an account
   *  balance. A depot value is derived from the transaction log and live
   *  prices, so there is no account to link — hence its own flag. Wins over
   *  `linkedAccountId`. */
  tracksInvestments: boolean;
  /** Which broker's depot is tracked; null = every portfolio combined. Only
   *  meaningful when `tracksInvestments`. */
  linkedPortfolioId: string | null;
  /** The goal this one is a sub-goal of; null = a top-level goal. Nesting is
   *  deliberately one level deep: a sub-goal is a line item ("flight"), not
   *  another project. Deleting a parent cascades to its sub-goals -- a
   *  sub-goal on its own means nothing. */
  parentGoalId: string | null;
}

/** How often a cash position's interest is credited and compounded. */
export type InterestFrequency = "MONTHLY" | "QUARTERLY" | "ANNUAL";

export const INTEREST_FREQUENCIES: InterestFrequency[] = ["MONTHLY", "QUARTERLY", "ANNUAL"];

/** Which calendar day interest posts on, within its period. */
export type InterestPostDay = "first" | "last";

export const INTEREST_POST_DAYS: InterestPostDay[] = ["first", "last"];

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
  /** Balance accounts + liabilities (ROADMAP #1, flag `accounts`). */
  accounts: Account[];
  /** Dated balance readings per account (see `AccountBalance`). */
  accountBalances: AccountBalance[];
  /** User-defined spending taxonomy (ROADMAP #2, flag `spending`). */
  spendingCategories: SpendingCategory[];
  /** Expense/income transactions against accounts (ROADMAP #2, flag `spending`). */
  spendingTransactions: SpendingTransaction[];
  /** Monthly per-category spending caps (ROADMAP #4, flag `budgets`). */
  budgets: Budget[];
  /** Named recurring commitments (ROADMAP #5, flag `contracts`). */
  contracts: Contract[];
  /** Planned income/expenses, e.g. salary (flag `plannedCashflow`). */
  plannedCashflows: PlannedCashflow[];
  /** Named savings goals (ROADMAP #6, flag `goals`). */
  goals: Goal[];
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
    accounts: [],
    accountBalances: [],
    spendingCategories: [],
    spendingTransactions: [],
    budgets: [],
    contracts: [],
    plannedCashflows: [],
    goals: [],
    llmConfig: null,
  };
}
