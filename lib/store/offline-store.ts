// Keeps Registered Mode usable offline — OFFLINE_DESIGN.md §2 phase 2 / §3.
// `OfflineStore` wraps an inner `DataStore` (in practice `SupabaseStore`) and
// a local mirror (a `LocalStore` pointed at a user-scoped key) so UI/finance
// code keeps calling the plain `DataStore` interface and never learns about
// connectivity — this file is the only place that does.
//
// Every mutation:
//   1. assigns the id up front (`newId()`) so the mirror entity and the
//      eventual server row share one uuid — replay in phase 3 is then
//      idempotent (§3's "one real wrinkle, and its fix");
//   2. applies optimistically to the mirror;
//   3. is attempted against the inner store. A genuine *network* failure is
//      queued for phase 3 to replay later (mirror's optimistic write stands).
//      A non-network failure (validation/RLS — we ARE online) means the
//      mutation was actually rejected: best-effort resync the mirror from
//      the server and rethrow, so the caller's own optimistic UI state
//      doesn't apply a change the server refused either.
//
// "Online" is decided by the real outcome of each inner-store call, never by
// `navigator.onLine` alone (wrong behind captive portals / flaky VPNs) — see
// lib/offline/connectivity.tsx for the equivalent read-side probe.

import type {
  Account,
  Asset,
  Budget,
  Contract,
  PlannedCashflow,
  Goal,
  LlmConfig,
  PensionContract,
  PensionPoint,
  PensionStatement,
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
import { drain, type DrainResult } from "../offline/sync";
import { LocalStore, mirrorStorageKeys } from "./local-store";
import { MutationQueue, type MutationOp } from "./mutation-queue";
import type {
  AccountInput,
  AssetInput,
  BudgetInput,
  ContractInput,
  PlannedCashflowInput,
  DataStore,
  GoalInput,
  PensionContractInput,
  PortfolioPatch,
  SavingsPlanInput,
  SimulationCacheEntry,
  SpendingCategoryInput,
  SpendingTransactionInput,
  TransactionInput,
  WatchlistInput,
} from "./types";
import { newId } from "./types";

/**
 * True only for fetch/network-level failures — never for app-level errors
 * (RLS denial, validation, `MAX_PORTFOLIOS`, etc.), which must still surface
 * to the caller instead of being silently queued.
 */
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch() throws TypeError on network failure
  if (err instanceof Error) {
    return /failed to fetch|fetch failed|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(
      err.message,
    );
  }
  return false;
}

export class OfflineStore implements DataStore {
  readonly persistent = true;
  private mirror: LocalStore;
  private queue: MutationQueue;

  constructor(
    private inner: DataStore,
    private userId: string,
    storage?: Storage,
  ) {
    this.mirror = new LocalStore(storage, mirrorStorageKeys(userId));
    this.queue = new MutationQueue(userId, storage);
  }

  private enqueue(op: MutationOp, id: string, payload: unknown): void {
    // Throws on quota failure (MutationQueue.append) — propagates up through
    // the mutation method so the caller sees a hard error, per §5.4: never
    // silently drop a mutation that couldn't be queued.
    this.queue.append(op, this.userId, id, payload);
  }

  /**
   * Called when the inner store rejects a mutation already applied
   * optimistically to the mirror. Network failure → queue for later replay.
   * Anything else → we're online and the server said no; resync the mirror
   * from server truth (best-effort) and rethrow so the caller doesn't treat
   * the rejected change as applied.
   */
  private async handleFailure(
    err: unknown,
    op: MutationOp,
    id: string,
    payload: unknown,
  ): Promise<void> {
    if (isNetworkError(err)) {
      this.enqueue(op, id, payload);
      return;
    }
    try {
      const fresh = await this.inner.load();
      await this.mirror.replaceAll(fresh);
    } catch {
      /* still offline-ish, or resync failed — leave the stale optimistic
         mirror write; a future successful load() will reconcile it. */
    }
    throw err;
  }

  async load(): Promise<PortfolioData> {
    try {
      const data = await this.inner.load();
      await this.mirror.replaceAll(data);
      return data;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return this.mirror.load();
    }
  }

  async saveProfile(profile: Profile): Promise<void> {
    await this.mirror.saveProfile(profile);
    try {
      await this.inner.saveProfile(profile);
    } catch (err) {
      // Profiles have no id of their own — the queue keys the op by userId.
      await this.handleFailure(err, "saveProfile", this.userId, profile);
    }
  }

  async addAsset(input: AssetInput, id?: string): Promise<Asset> {
    const assetId = id ?? newId();
    const asset = await this.mirror.addAsset(input, assetId);
    try {
      await this.inner.addAsset(input, assetId);
    } catch (err) {
      await this.handleFailure(err, "addAsset", assetId, input);
    }
    return asset;
  }

  async updateAsset(id: string, patch: Partial<AssetInput>): Promise<void> {
    await this.mirror.updateAsset(id, patch);
    try {
      await this.inner.updateAsset(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updateAsset", id, patch);
    }
  }

  async deleteAsset(id: string): Promise<void> {
    await this.mirror.deleteAsset(id);
    try {
      await this.inner.deleteAsset(id);
    } catch (err) {
      await this.handleFailure(err, "deleteAsset", id, null);
    }
  }

  async addTransaction(input: TransactionInput, id?: string): Promise<Transaction> {
    const txId = id ?? newId();
    const tx = await this.mirror.addTransaction(input, txId);
    try {
      await this.inner.addTransaction(input, txId);
    } catch (err) {
      await this.handleFailure(err, "addTransaction", txId, input);
    }
    return tx;
  }

  async updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<void> {
    await this.mirror.updateTransaction(id, patch);
    try {
      await this.inner.updateTransaction(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updateTransaction", id, patch);
    }
  }

  async deleteTransaction(id: string): Promise<void> {
    await this.mirror.deleteTransaction(id);
    try {
      await this.inner.deleteTransaction(id);
    } catch (err) {
      await this.handleFailure(err, "deleteTransaction", id, null);
    }
  }

  async addWatchlistItem(input: WatchlistInput, id?: string): Promise<WatchlistItem> {
    const itemId = id ?? newId();
    const item = await this.mirror.addWatchlistItem(input, itemId);
    try {
      await this.inner.addWatchlistItem(input, itemId);
    } catch (err) {
      await this.handleFailure(err, "addWatchlistItem", itemId, input);
    }
    return item;
  }

  async removeWatchlistItem(id: string): Promise<void> {
    await this.mirror.removeWatchlistItem(id);
    try {
      await this.inner.removeWatchlistItem(id);
    } catch (err) {
      await this.handleFailure(err, "removeWatchlistItem", id, null);
    }
  }

  async updateWatchlistItem(id: string, patch: Partial<WatchlistInput>): Promise<void> {
    await this.mirror.updateWatchlistItem(id, patch);
    try {
      await this.inner.updateWatchlistItem(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updateWatchlistItem", id, patch);
    }
  }

  async addSavingsPlan(input: SavingsPlanInput, id?: string): Promise<SavingsPlan> {
    const planId = id ?? newId();
    const plan = await this.mirror.addSavingsPlan(input, planId);
    try {
      await this.inner.addSavingsPlan(input, planId);
    } catch (err) {
      await this.handleFailure(err, "addSavingsPlan", planId, input);
    }
    return plan;
  }

  async updateSavingsPlan(id: string, patch: Partial<SavingsPlanInput>): Promise<void> {
    await this.mirror.updateSavingsPlan(id, patch);
    try {
      await this.inner.updateSavingsPlan(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updateSavingsPlan", id, patch);
    }
  }

  async deleteSavingsPlan(id: string): Promise<void> {
    await this.mirror.deleteSavingsPlan(id);
    try {
      await this.inner.deleteSavingsPlan(id);
    } catch (err) {
      await this.handleFailure(err, "deleteSavingsPlan", id, null);
    }
  }

  async addTagGroup(name: string, id?: string): Promise<TagGroup> {
    const groupId = id ?? newId();
    const group = await this.mirror.addTagGroup(name, groupId);
    try {
      await this.inner.addTagGroup(name, groupId);
    } catch (err) {
      await this.handleFailure(err, "addTagGroup", groupId, { name });
    }
    return group;
  }

  async renameTagGroup(id: string, name: string): Promise<void> {
    await this.mirror.renameTagGroup(id, name);
    try {
      await this.inner.renameTagGroup(id, name);
    } catch (err) {
      await this.handleFailure(err, "renameTagGroup", id, { name });
    }
  }

  async deleteTagGroup(id: string): Promise<void> {
    await this.mirror.deleteTagGroup(id);
    try {
      await this.inner.deleteTagGroup(id);
    } catch (err) {
      await this.handleFailure(err, "deleteTagGroup", id, null);
    }
  }

  async setAssetTags(assetId: string, groupId: string, values: string[]): Promise<void> {
    await this.mirror.setAssetTags(assetId, groupId, values);
    // No single natural "id" for a (asset, group) pair — key the queued op by
    // their composite so it's still identifiable for debugging; the replay
    // in lib/offline/sync.ts reads assetId/groupId/values from the payload,
    // never from this id.
    try {
      await this.inner.setAssetTags(assetId, groupId, values);
    } catch (err) {
      await this.handleFailure(err, "setAssetTags", `${assetId}:${groupId}`, {
        assetId,
        groupId,
        values,
      });
    }
  }

  async setAssetValuations(assetId: string, points: { date: string; value: number }[]): Promise<void> {
    await this.mirror.setAssetValuations(assetId, points);
    // Keyed by assetId; the replay reads assetId/points from the payload, and
    // replace-set makes it idempotent regardless of ordering (like setAssetTags).
    try {
      await this.inner.setAssetValuations(assetId, points);
    } catch (err) {
      await this.handleFailure(err, "setAssetValuations", assetId, { assetId, points });
    }
  }

  async addAccount(input: AccountInput, id?: string): Promise<Account> {
    const accountId = id ?? newId();
    const account = await this.mirror.addAccount(input, accountId);
    try {
      await this.inner.addAccount(input, accountId);
    } catch (err) {
      await this.handleFailure(err, "addAccount", accountId, input);
    }
    return account;
  }

  async updateAccount(id: string, patch: Partial<AccountInput>): Promise<void> {
    await this.mirror.updateAccount(id, patch);
    try {
      await this.inner.updateAccount(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updateAccount", id, patch);
    }
  }

  async deleteAccount(id: string): Promise<void> {
    await this.mirror.deleteAccount(id);
    try {
      await this.inner.deleteAccount(id);
    } catch (err) {
      await this.handleFailure(err, "deleteAccount", id, null);
    }
  }

  async setAccountBalances(
    accountId: string,
    points: { date: string; balance: number }[],
  ): Promise<void> {
    await this.mirror.setAccountBalances(accountId, points);
    // Keyed by accountId; the replay reads accountId/points from the payload,
    // and replace-set makes it idempotent (like setAssetValuations).
    try {
      await this.inner.setAccountBalances(accountId, points);
    } catch (err) {
      await this.handleFailure(err, "setAccountBalances", accountId, { accountId, points });
    }
  }

  async setPensionPoints(entries: PensionPoint[]): Promise<void> {
    await this.mirror.setPensionPoints(entries);
    // Replace-set over the user's whole record, so there is no per-row key to
    // dedupe on — "pension" is the queue key, and a replay is idempotent.
    try {
      await this.inner.setPensionPoints(entries);
    } catch (err) {
      await this.handleFailure(err, "setPensionPoints", "pension", { entries });
    }
  }

  async setPensionStatements(entries: PensionStatement[]): Promise<void> {
    await this.mirror.setPensionStatements(entries);
    // Replace-set over the whole record, same shape as setPensionPoints.
    try {
      await this.inner.setPensionStatements(entries);
    } catch (err) {
      await this.handleFailure(err, "setPensionStatements", "pension-statements", { entries });
    }
  }

  async addPensionContract(
    input: PensionContractInput,
    id?: string,
  ): Promise<PensionContract> {
    const contractId = id ?? newId();
    const contract = await this.mirror.addPensionContract(input, contractId);
    try {
      await this.inner.addPensionContract(input, contractId);
    } catch (err) {
      await this.handleFailure(err, "addPensionContract", contractId, input);
    }
    return contract;
  }

  async updatePensionContract(
    id: string,
    patch: Partial<PensionContractInput>,
  ): Promise<void> {
    await this.mirror.updatePensionContract(id, patch);
    try {
      await this.inner.updatePensionContract(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updatePensionContract", id, patch);
    }
  }

  async deletePensionContract(id: string): Promise<void> {
    await this.mirror.deletePensionContract(id);
    try {
      await this.inner.deletePensionContract(id);
    } catch (err) {
      await this.handleFailure(err, "deletePensionContract", id, null);
    }
  }

  async addSpendingCategory(input: SpendingCategoryInput, id?: string): Promise<SpendingCategory> {
    const categoryId = id ?? newId();
    const category = await this.mirror.addSpendingCategory(input, categoryId);
    try {
      await this.inner.addSpendingCategory(input, categoryId);
    } catch (err) {
      await this.handleFailure(err, "addSpendingCategory", categoryId, input);
    }
    return category;
  }

  async updateSpendingCategory(id: string, patch: Partial<SpendingCategoryInput>): Promise<void> {
    await this.mirror.updateSpendingCategory(id, patch);
    try {
      await this.inner.updateSpendingCategory(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updateSpendingCategory", id, patch);
    }
  }

  async deleteSpendingCategory(id: string): Promise<void> {
    await this.mirror.deleteSpendingCategory(id);
    try {
      await this.inner.deleteSpendingCategory(id);
    } catch (err) {
      await this.handleFailure(err, "deleteSpendingCategory", id, null);
    }
  }

  async addSpendingTransaction(
    input: SpendingTransactionInput,
    id?: string,
  ): Promise<SpendingTransaction> {
    const transactionId = id ?? newId();
    const transaction = await this.mirror.addSpendingTransaction(input, transactionId);
    try {
      await this.inner.addSpendingTransaction(input, transactionId);
    } catch (err) {
      await this.handleFailure(err, "addSpendingTransaction", transactionId, input);
    }
    return transaction;
  }

  async updateSpendingTransaction(
    id: string,
    patch: Partial<SpendingTransactionInput>,
  ): Promise<void> {
    await this.mirror.updateSpendingTransaction(id, patch);
    try {
      await this.inner.updateSpendingTransaction(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updateSpendingTransaction", id, patch);
    }
  }

  async deleteSpendingTransaction(id: string): Promise<void> {
    await this.mirror.deleteSpendingTransaction(id);
    try {
      await this.inner.deleteSpendingTransaction(id);
    } catch (err) {
      await this.handleFailure(err, "deleteSpendingTransaction", id, null);
    }
  }

  async addBudget(input: BudgetInput, id?: string): Promise<Budget> {
    const budgetId = id ?? newId();
    const budget = await this.mirror.addBudget(input, budgetId);
    try {
      await this.inner.addBudget(input, budgetId);
    } catch (err) {
      await this.handleFailure(err, "addBudget", budgetId, input);
    }
    return budget;
  }

  async updateBudget(id: string, patch: Partial<BudgetInput>): Promise<void> {
    await this.mirror.updateBudget(id, patch);
    try {
      await this.inner.updateBudget(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updateBudget", id, patch);
    }
  }

  async deleteBudget(id: string): Promise<void> {
    await this.mirror.deleteBudget(id);
    try {
      await this.inner.deleteBudget(id);
    } catch (err) {
      await this.handleFailure(err, "deleteBudget", id, null);
    }
  }

  async addContract(input: ContractInput, id?: string): Promise<Contract> {
    const contractId = id ?? newId();
    const contract = await this.mirror.addContract(input, contractId);
    try {
      await this.inner.addContract(input, contractId);
    } catch (err) {
      await this.handleFailure(err, "addContract", contractId, input);
    }
    return contract;
  }

  async updateContract(id: string, patch: Partial<ContractInput>): Promise<void> {
    await this.mirror.updateContract(id, patch);
    try {
      await this.inner.updateContract(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updateContract", id, patch);
    }
  }

  async deleteContract(id: string): Promise<void> {
    await this.mirror.deleteContract(id);
    try {
      await this.inner.deleteContract(id);
    } catch (err) {
      await this.handleFailure(err, "deleteContract", id, null);
    }
  }

  async addPlannedCashflow(input: PlannedCashflowInput, id?: string): Promise<PlannedCashflow> {
    const plannedId = id ?? newId();
    const planned = await this.mirror.addPlannedCashflow(input, plannedId);
    try {
      await this.inner.addPlannedCashflow(input, plannedId);
    } catch (err) {
      await this.handleFailure(err, "addPlannedCashflow", plannedId, input);
    }
    return planned;
  }

  async updatePlannedCashflow(id: string, patch: Partial<PlannedCashflowInput>): Promise<void> {
    await this.mirror.updatePlannedCashflow(id, patch);
    try {
      await this.inner.updatePlannedCashflow(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updatePlannedCashflow", id, patch);
    }
  }

  async deletePlannedCashflow(id: string): Promise<void> {
    await this.mirror.deletePlannedCashflow(id);
    try {
      await this.inner.deletePlannedCashflow(id);
    } catch (err) {
      await this.handleFailure(err, "deletePlannedCashflow", id, null);
    }
  }

  async addGoal(input: GoalInput, id?: string): Promise<Goal> {
    const goalId = id ?? newId();
    const goal = await this.mirror.addGoal(input, goalId);
    try {
      await this.inner.addGoal(input, goalId);
    } catch (err) {
      await this.handleFailure(err, "addGoal", goalId, input);
    }
    return goal;
  }

  async updateGoal(id: string, patch: Partial<GoalInput>): Promise<void> {
    await this.mirror.updateGoal(id, patch);
    try {
      await this.inner.updateGoal(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updateGoal", id, patch);
    }
  }

  async deleteGoal(id: string): Promise<void> {
    await this.mirror.deleteGoal(id);
    try {
      await this.inner.deleteGoal(id);
    } catch (err) {
      await this.handleFailure(err, "deleteGoal", id, null);
    }
  }

  async saveLlmConfig(config: LlmConfig | null): Promise<void> {
    await this.mirror.saveLlmConfig(config);
    try {
      await this.inner.saveLlmConfig(config);
    } catch (err) {
      // No id of its own, like saveProfile — the queue keys the op by userId.
      await this.handleFailure(err, "saveLlmConfig", this.userId, config);
    }
  }

  async createPortfolio(name: string, id?: string): Promise<Portfolio> {
    const portfolioId = id ?? newId();
    const portfolio = await this.mirror.createPortfolio(name, portfolioId);
    try {
      await this.inner.createPortfolio(name, portfolioId);
    } catch (err) {
      await this.handleFailure(err, "createPortfolio", portfolioId, { name });
    }
    return portfolio;
  }

  async renamePortfolio(id: string, name: string): Promise<void> {
    await this.mirror.renamePortfolio(id, name);
    try {
      await this.inner.renamePortfolio(id, name);
    } catch (err) {
      await this.handleFailure(err, "renamePortfolio", id, { name });
    }
  }

  async updatePortfolio(id: string, patch: PortfolioPatch): Promise<void> {
    await this.mirror.updatePortfolio(id, patch);
    try {
      await this.inner.updatePortfolio(id, patch);
    } catch (err) {
      await this.handleFailure(err, "updatePortfolio", id, patch);
    }
  }

  async deletePortfolio(id: string): Promise<void> {
    await this.mirror.deletePortfolio(id);
    try {
      await this.inner.deletePortfolio(id);
    } catch (err) {
      await this.handleFailure(err, "deletePortfolio", id, null);
    }
  }

  // Simulation cache + import fingerprints are non-critical, re-derivable
  // caches — ridden on the mirror (§2 phase 2 note) but deliberately never
  // queued, to keep the queue small and ops-only (§5.4).

  async loadSimulation(hash: string): Promise<SimulationCacheEntry | null> {
    try {
      const entry = await this.inner.loadSimulation(hash);
      if (entry) await this.mirror.saveSimulation(entry);
      return entry;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return this.mirror.loadSimulation(hash);
    }
  }

  async saveSimulation(entry: SimulationCacheEntry): Promise<void> {
    await this.mirror.saveSimulation(entry);
    try {
      await this.inner.saveSimulation(entry);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      // best-effort only — not queued.
    }
  }

  async loadImportedFingerprints(): Promise<string[]> {
    try {
      return await this.inner.loadImportedFingerprints();
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return this.mirror.loadImportedFingerprints();
    }
  }

  async addImportedFingerprints(
    entries: { fingerprint: string; transactionId: string | null }[],
  ): Promise<void> {
    await this.mirror.addImportedFingerprints(entries);
    try {
      await this.inner.addImportedFingerprints(entries);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      // best-effort only — not queued.
    }
  }

  async loadImportedSpendingFingerprints(): Promise<string[]> {
    try {
      return await this.inner.loadImportedSpendingFingerprints();
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return this.mirror.loadImportedSpendingFingerprints();
    }
  }

  async addImportedSpendingFingerprints(
    entries: { fingerprint: string; spendingTransactionId: string | null }[],
  ): Promise<void> {
    await this.mirror.addImportedSpendingFingerprints(entries);
    try {
      await this.inner.addImportedSpendingFingerprints(entries);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      // best-effort only — not queued.
    }
  }

  // --- Phase 3: reconnect sync (OFFLINE_DESIGN.md §2 phase 3) ---------------
  //
  // These are the "minimal accessors" the sync layer needs: `lib/offline/
  // sync.ts` only knows about the plain `DataStore`/`MutationQueue` shapes, so
  // this class is the seam that hands it *this* instance's queue + inner
  // store, and — on a full drain — folds the result back into the mirror the
  // same way `load()` does. `SyncProvider` (lib/offline/sync-context.tsx)
  // reads the active store via `usePortfolio()`, narrows it to `OfflineStore`,
  // and drives these two members; nothing else needs to know this class
  // exists.

  /** Ops still waiting to be replayed against the server. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Drains the queue against `inner`, per OFFLINE_DESIGN.md §4. Refuses (see
   * `DrainStatus`) if `currentUserId` doesn't match the queue this store was
   * constructed for — a defence against a stale timer/effect firing after the
   * signed-in user changed (§5.2). On a full drain, folds the freshly loaded
   * server data into the mirror in the same pass `drain()` already fetched it
   * in, so the caller doesn't need a second `load()` round trip.
   */
  async sync(currentUserId: string): Promise<DrainResult> {
    if (currentUserId !== this.userId) {
      return { applied: 0, dropped: 0, status: "refused" };
    }
    const result = await drain(this.queue, this.inner, currentUserId);
    if (result.status === "synced" && result.data) {
      try {
        await this.mirror.replaceAll(result.data);
      } catch {
        /* best-effort — a later load() will reconcile the mirror. */
      }
    }
    return result;
  }
}
