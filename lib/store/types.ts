// Storage abstraction. The same interface is implemented twice:
//   - LocalStore   → browser storage (Guest Mode, PRD §2.1)
//   - SupabaseStore → Postgres via Supabase (Registered Mode, PRD §2.2)
// The active implementation is chosen by auth state in store/index.ts, so UI
// and finance code never branch on the mode.

import type {
  Account,
  Asset,
  Budget,
  Contract,
  Goal,
  LlmConfig,
  PensionContract,
  PensionPoint,
  PlannedCashflow,
  Portfolio,
  PortfolioData,
  Profile,
  SavingsPlan,
  SpendingCategory,
  SpendingTransaction,
  TagGroup,
  Transaction,
  WatchlistItem,
} from "../types";

export type AssetInput = Omit<Asset, "id">;
export type TransactionInput = Omit<Transaction, "id">;
export type WatchlistInput = Omit<WatchlistItem, "id">;
export type SavingsPlanInput = Omit<SavingsPlan, "id">;
export type AccountInput = Omit<Account, "id">;
export type SpendingCategoryInput = Omit<SpendingCategory, "id">;
export type SpendingTransactionInput = Omit<SpendingTransaction, "id">;
export type BudgetInput = Omit<Budget, "id">;
export type ContractInput = Omit<Contract, "id">;
export type PlannedCashflowInput = Omit<PlannedCashflow, "id">;
export type GoalInput = Omit<Goal, "id">;
export type PensionContractInput = Omit<PensionContract, "id">;

/** Patch shape for `DataStore.updatePortfolio` — every field optional, only
 *  the fields present are changed. `renamePortfolio` is a thin wrapper around
 *  this with just `{ name }`. */
export interface PortfolioPatch {
  name?: string;
  feeOrderFlat?: number;
  feeOrderFreeFrom?: number | null;
  feeSavingsPlan?: number;
  taxAllowance?: number | null;
}

/** A cached Monte Carlo run, keyed by a hash of its (seed-independent) params. */
export interface SimulationCacheEntry {
  hash: string;
  params: unknown;
  seed: number;
  result: unknown;
  createdAt: string;
}

export interface DataStore {
  /** Whether this store persists across sessions/devices. */
  readonly persistent: boolean;
  load(): Promise<PortfolioData>;
  saveProfile(profile: Profile): Promise<void>;
  /**
   * `id` is an optional caller-supplied uuid (OFFLINE_DESIGN.md §2 phase 2 /
   * §3): `OfflineStore` assigns the id up front so its optimistic local
   * mirror and the eventual server row share one uuid, making queued replay
   * idempotent. Omitted, implementations generate one as before.
   */
  addAsset(input: AssetInput, id?: string): Promise<Asset>;
  updateAsset(id: string, patch: Partial<AssetInput>): Promise<void>;
  deleteAsset(id: string): Promise<void>;
  addTransaction(input: TransactionInput, id?: string): Promise<Transaction>;
  updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  addWatchlistItem(input: WatchlistInput, id?: string): Promise<WatchlistItem>;
  removeWatchlistItem(id: string): Promise<void>;
  updateWatchlistItem(id: string, patch: Partial<WatchlistInput>): Promise<void>;
  addSavingsPlan(input: SavingsPlanInput, id?: string): Promise<SavingsPlan>;
  updateSavingsPlan(id: string, patch: Partial<SavingsPlanInput>): Promise<void>;
  deleteSavingsPlan(id: string): Promise<void>;
  /** Creates a tag group. `id` — see `addAsset`'s doc above. */
  addTagGroup(name: string, id?: string): Promise<TagGroup>;
  renameTagGroup(id: string, name: string): Promise<void>;
  /** Deletes the group and every assignment that referenced it. */
  deleteTagGroup(id: string): Promise<void>;
  /**
   * Replace-set: the given `groupId`'s values for `assetId` become exactly
   * `values` (idempotent, replay-safe). An empty array clears the pair.
   */
  setAssetTags(assetId: string, groupId: string, values: string[]): Promise<void>;
  /**
   * Replace-set the manual valuation points for one OTHER asset (idempotent,
   * replay-safe like `setAssetTags`). The given array becomes exactly the
   * asset's points; an empty array clears them.
   */
  setAssetValuations(assetId: string, points: { date: string; value: number }[]): Promise<void>;
  /** Creates a balance account/liability. `id` — see `addAsset`'s doc above. */
  addAccount(input: AccountInput, id?: string): Promise<Account>;
  updateAccount(id: string, patch: Partial<AccountInput>): Promise<void>;
  /** Deletes the account and every balance reading that referenced it. */
  deleteAccount(id: string): Promise<void>;
  /**
   * Replace-set the dated balance readings for one account (idempotent,
   * replay-safe like `setAssetValuations`). The given array becomes exactly
   * the account's readings; an empty array clears them.
   */
  setAccountBalances(accountId: string, points: { date: string; balance: number }[]): Promise<void>;
  /**
   * Replace-set the planned one-off repayments (Sondertilgungen) of one
   * liability account, same idempotent/replay-safe contract as
   * `setAccountBalances`. Amounts are native-currency magnitudes.
   */
  setExtraRepayments(accountId: string, points: { date: string; amount: number }[]): Promise<void>;
  /**
   * Replace-set the whole statutory pension record (flag `pension`), keyed by
   * year the way `setAccountBalances` is keyed by date -- idempotent and
   * replay-safe, and a year can never end up recorded twice.
   */
  setPensionPoints(entries: PensionPoint[]): Promise<void>;
  /** Creates a retirement policy. `id` — see `addAsset`'s doc above. */
  addPensionContract(input: PensionContractInput, id?: string): Promise<PensionContract>;
  updatePensionContract(id: string, patch: Partial<PensionContractInput>): Promise<void>;
  deletePensionContract(id: string): Promise<void>;
  /** Creates a spending category. `id` — see `addAsset`'s doc above. */
  addSpendingCategory(input: SpendingCategoryInput, id?: string): Promise<SpendingCategory>;
  updateSpendingCategory(id: string, patch: Partial<SpendingCategoryInput>): Promise<void>;
  /** Deletes the category; referencing transactions keep their `categoryId` set to null. */
  deleteSpendingCategory(id: string): Promise<void>;
  /** Creates a spending transaction. `id` — see `addAsset`'s doc above. */
  addSpendingTransaction(input: SpendingTransactionInput, id?: string): Promise<SpendingTransaction>;
  updateSpendingTransaction(id: string, patch: Partial<SpendingTransactionInput>): Promise<void>;
  deleteSpendingTransaction(id: string): Promise<void>;
  /** Creates a monthly budget cap for a category. `id` — see `addAsset`'s doc above. */
  addBudget(input: BudgetInput, id?: string): Promise<Budget>;
  updateBudget(id: string, patch: Partial<BudgetInput>): Promise<void>;
  deleteBudget(id: string): Promise<void>;
  /** Creates a recurring-commitment contract. `id` — see `addAsset`'s doc above. */
  addContract(input: ContractInput, id?: string): Promise<Contract>;
  updateContract(id: string, patch: Partial<ContractInput>): Promise<void>;
  deleteContract(id: string): Promise<void>;
  /** Creates a planned income/expense (salary, bonus, one-off cost).
   *  `id` — see `addAsset`'s doc above. */
  addPlannedCashflow(input: PlannedCashflowInput, id?: string): Promise<PlannedCashflow>;
  updatePlannedCashflow(id: string, patch: Partial<PlannedCashflowInput>): Promise<void>;
  deletePlannedCashflow(id: string): Promise<void>;
  /** Creates a named savings goal. `id` — see `addAsset`'s doc above. */
  addGoal(input: GoalInput, id?: string): Promise<Goal>;
  updateGoal(id: string, patch: Partial<GoalInput>): Promise<void>;
  deleteGoal(id: string): Promise<void>;
  /**
   * Replace-set the user's BYO LLM config (replay-idempotent like
   * `setAssetTags`). `null` removes it entirely (the settings "Remove key"
   * action).
   */
  saveLlmConfig(config: LlmConfig | null): Promise<void>;
  createPortfolio(name: string, id?: string): Promise<Portfolio>;
  renamePortfolio(id: string, name: string): Promise<void>;
  /** Patches name and/or fee-model fields (settings "Broker & fees"). */
  updatePortfolio(id: string, patch: PortfolioPatch): Promise<void>;
  /** Deletes the portfolio, its transactions, and assets held only in it. */
  deletePortfolio(id: string): Promise<void>;
  /** Reuse a previously computed simulation with identical params, or null. */
  loadSimulation(hash: string): Promise<SimulationCacheEntry | null>;
  saveSimulation(entry: SimulationCacheEntry): Promise<void>;
  /** Fingerprints of CSV rows already imported (so re-imports skip them). */
  loadImportedFingerprints(): Promise<string[]>;
  /**
   * Records fingerprints, each tied to the transaction it created or merged
   * into (null for legacy/unknown), so deleting that transaction — directly,
   * via asset delete, or via portfolio delete — cascades the fingerprint away
   * too instead of leaking and blocking re-import.
   */
  addImportedFingerprints(
    entries: { fingerprint: string; transactionId: string | null }[],
  ): Promise<void>;
  /** Fingerprints of bank-statement rows already imported into spending
   *  transactions (ROADMAP item #3) — separate from `loadImportedFingerprints`
   *  above since spending rows have no ISIN/WKN to key off of and live in a
   *  different table. */
  loadImportedSpendingFingerprints(): Promise<string[]>;
  /** Records fingerprints, each tied to the spending transaction it created
   *  (null for a merge into an already-identical existing row), so deleting
   *  that transaction — directly or via account delete — cascades the
   *  fingerprint away too. */
  addImportedSpendingFingerprints(
    entries: { fingerprint: string; spendingTransactionId: string | null }[],
  ): Promise<void>;
}

/**
 * Thrown by `updateAsset`/`updateTransaction` when the target row no longer
 * exists server-side (e.g. deleted from another device/tab in the meantime).
 * Distinguishing this from a generic error lets the phase-3 offline replay
 * (`lib/offline/sync.ts`) apply the LWW rule from OFFLINE_DESIGN.md §4: a
 * cross-device delete wins over a stale queued update, so the op is dropped
 * rather than retried forever. `SupabaseStore` previously let a zero-row
 * update pass silently (Postgres doesn't error on an UPDATE that matches no
 * rows) — it now `.select()`s the affected row and throws this instead.
 */
export class RowNotFoundError extends Error {
  constructor(message = "Row not found") {
    super(message);
    this.name = "RowNotFoundError";
  }
}

export function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
