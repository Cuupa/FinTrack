// Guest Mode storage (PRD §2.1): everything lives in the browser. Data is
// lost when the user clears their browser storage — the UI surfaces this via
// the guest banner. Defaults to localStorage; pass sessionStorage for
// truly ephemeral sessions.

import {
  emptyPortfolio,
  MAX_PORTFOLIOS,
  type LlmConfig,
  type PortfolioData,
  type Profile,
  type TagAssignments,
} from "../types";
import { isNativeQuotaError, StorageFullError } from "./errors";
import type {
  AccountInput,
  AssetInput,
  DataStore,
  PortfolioPatch,
  SavingsPlanInput,
  SimulationCacheEntry,
  TransactionInput,
  WatchlistInput,
} from "./types";
import { newId } from "./types";

const STORAGE_KEY = "fintrack:portfolio:v1";
const SIM_KEY = "fintrack:simulations:v1";
const IMPORT_KEY = "fintrack:imported:v1";

/** The three localStorage keys a LocalStore instance reads/writes. */
export interface LocalStoreKeys {
  portfolio: string;
  simulations: string;
  imported: string;
}

const GUEST_KEYS: LocalStoreKeys = {
  portfolio: STORAGE_KEY,
  simulations: SIM_KEY,
  imported: IMPORT_KEY,
};

/**
 * User-scoped key set for the offline mirror (OFFLINE_DESIGN.md §2 phase 2),
 * distinct from the Guest Mode keys above so signing out to Guest Mode on the
 * same device never blends a registered user's data into the guest store —
 * and distinct *per user* so two registered accounts on a shared device don't
 * blend simulation caches / import fingerprints either (§5.4).
 */
export function mirrorStorageKeys(userId: string): LocalStoreKeys {
  const base = `fintrack:mirror:${userId}:v1`;
  return {
    portfolio: base,
    simulations: `fintrack:mirror:${userId}:simulations:v1`,
    imported: `fintrack:mirror:${userId}:imported:v1`,
  };
}

export class LocalStore implements DataStore {
  readonly persistent = false;
  private storage: Storage;
  private keys: LocalStoreKeys;

  constructor(storage?: Storage, keys: LocalStoreKeys = GUEST_KEYS) {
    // Fall back to an in-memory shim during SSR / when storage is unavailable.
    this.storage = storage ?? memoryStorageFallback();
    this.keys = keys;
  }

  private read(): PortfolioData {
    try {
      const raw = this.storage.getItem(this.keys.portfolio);
      if (!raw) return emptyPortfolio();
      const parsed = JSON.parse(raw) as PortfolioData;
      // Ensure at least one portfolio, and backfill transactions saved before
      // multi-portfolio (no portfolioId) to the default portfolio.
      const portfolios = (
        parsed.portfolios && parsed.portfolios.length > 0
          ? parsed.portfolios
          : emptyPortfolio().portfolios
      ).map((p) => ({
        ...p,
        // Backfill portfolios saved before the fee model existed.
        feeOrderFlat: p.feeOrderFlat ?? 0,
        feeOrderFreeFrom: p.feeOrderFreeFrom ?? null,
        feeSavingsPlan: p.feeSavingsPlan ?? 0,
        // Backfill portfolios saved before the per-broker allowance existed.
        taxAllowance: p.taxAllowance ?? null,
      }));
      const fallbackId = portfolios[0].id;
      return {
        // Merge over defaults so profiles saved before new fields (name, locale)
        // still have them.
        profile: { ...emptyPortfolio().profile, ...(parsed.profile ?? {}) },
        portfolios,
        assets: parsed.assets ?? [],
        transactions: (parsed.transactions ?? []).map((t) => ({
          ...t,
          portfolioId: t.portfolioId ?? fallbackId,
          // Backfill transactions saved before the tax field existed.
          tax: t.tax ?? 0,
        })),
        // Backfill portfolios saved before the watchlist / savings plans existed.
        watchlist: parsed.watchlist ?? [],
        savingsPlans: parsed.savingsPlans ?? [],
        // Backfill portfolios saved before tags moved onto the store seam
        // (they used to live in a separate `fintrack-tags` key entirely).
        tagGroups: parsed.tagGroups ?? [],
        tagAssignments: parsed.tagAssignments ?? {},
        // Backfill blobs saved before manual-valuation (OTHER) assets existed.
        valuationPoints: parsed.valuationPoints ?? [],
        // Backfill blobs saved before the accounts entity existed.
        accounts: parsed.accounts ?? [],
        accountBalances: parsed.accountBalances ?? [],
        // Backfill portfolios saved before the LLM config moved onto the
        // store seam (it used to live in a separate `fintrack-llm` key).
        llmConfig: parsed.llmConfig ?? null,
      };
    } catch {
      return emptyPortfolio();
    }
  }

  private write(data: PortfolioData): void {
    // Unlike saveSimulation/writeImportRecord below (best-effort caches, safe
    // to drop), a portfolio-data write failure must never be silently
    // swallowed: silently ignoring it here would mean localStorage keeps the
    // OLD data while the in-memory PortfolioData the caller just mutated
    // moves on as if the write succeeded, so a guest reloading the page would
    // then lose the change with no warning. So on quota, throw a tagged
    // `StorageFullError` that propagates through every mutation method
    // (addAsset, addTransaction, …) to the caller; any other error rethrows
    // untagged.
    try {
      this.storage.setItem(this.keys.portfolio, JSON.stringify(data));
    } catch (err) {
      if (isNativeQuotaError(err)) throw new StorageFullError();
      throw err;
    }
  }

  async load(): Promise<PortfolioData> {
    return this.read();
  }

  /**
   * Full write-through replace — used by `OfflineStore` to mirror a
   * successful `inner.load()` result verbatim (OFFLINE_DESIGN.md §2 phase 2).
   */
  async replaceAll(data: PortfolioData): Promise<void> {
    this.write(data);
  }

  async saveProfile(profile: Profile): Promise<void> {
    const data = this.read();
    data.profile = profile;
    this.write(data);
  }

  async addAsset(input: AssetInput, id?: string) {
    const data = this.read();
    const asset = { ...input, id: id ?? newId() };
    data.assets.push(asset);
    this.write(data);
    return asset;
  }

  async updateAsset(id: string, patch: Partial<AssetInput>) {
    const data = this.read();
    const idx = data.assets.findIndex((a) => a.id === id);
    if (idx >= 0) {
      data.assets[idx] = { ...data.assets[idx], ...patch };
      this.write(data);
    }
  }

  async deleteAsset(id: string) {
    const data = this.read();
    data.assets = data.assets.filter((a) => a.id !== id);
    const removedIds = data.transactions.filter((t) => t.assetId === id).map((t) => t.id);
    data.transactions = data.transactions.filter((t) => t.assetId !== id);
    // Cascade: a plan without its asset can never execute again.
    data.savingsPlans = data.savingsPlans.filter((p) => p.assetId !== id);
    // Cascade: tag assignments for a deleted asset are meaningless.
    if (id in data.tagAssignments) {
      const tagAssignments = { ...data.tagAssignments };
      delete tagAssignments[id];
      data.tagAssignments = tagAssignments;
    }
    // Cascade: valuation points belong to their asset.
    data.valuationPoints = data.valuationPoints.filter((p) => p.assetId !== id);
    this.write(data);
    this.pruneImportedFingerprints(removedIds);
  }

  async addTransaction(input: TransactionInput, id?: string) {
    const data = this.read();
    const tx = { ...input, id: id ?? newId() };
    data.transactions.push(tx);
    this.write(data);
    return tx;
  }

  async updateTransaction(id: string, patch: Partial<TransactionInput>) {
    const data = this.read();
    const idx = data.transactions.findIndex((t) => t.id === id);
    if (idx >= 0) {
      data.transactions[idx] = { ...data.transactions[idx], ...patch };
      this.write(data);
    }
  }

  async deleteTransaction(id: string) {
    const data = this.read();
    data.transactions = data.transactions.filter((t) => t.id !== id);
    this.write(data);
    this.pruneImportedFingerprints([id]);
  }

  async addWatchlistItem(input: WatchlistInput, id?: string) {
    const data = this.read();
    const item = { ...input, id: id ?? newId() };
    data.watchlist.push(item);
    this.write(data);
    return item;
  }

  async removeWatchlistItem(id: string) {
    const data = this.read();
    data.watchlist = data.watchlist.filter((w) => w.id !== id);
    this.write(data);
  }

  async updateWatchlistItem(id: string, patch: Partial<WatchlistInput>) {
    const data = this.read();
    const idx = data.watchlist.findIndex((w) => w.id === id);
    if (idx >= 0) {
      data.watchlist[idx] = { ...data.watchlist[idx], ...patch };
      this.write(data);
    }
  }

  async addSavingsPlan(input: SavingsPlanInput, id?: string) {
    const data = this.read();
    const plan = { ...input, id: id ?? newId() };
    data.savingsPlans.push(plan);
    this.write(data);
    return plan;
  }

  async updateSavingsPlan(id: string, patch: Partial<SavingsPlanInput>) {
    const data = this.read();
    const idx = data.savingsPlans.findIndex((p) => p.id === id);
    if (idx >= 0) {
      data.savingsPlans[idx] = { ...data.savingsPlans[idx], ...patch };
      this.write(data);
    }
  }

  async deleteSavingsPlan(id: string) {
    const data = this.read();
    data.savingsPlans = data.savingsPlans.filter((p) => p.id !== id);
    this.write(data);
  }

  async addTagGroup(name: string, id?: string) {
    const data = this.read();
    const group = { id: id ?? newId(), name: name.trim() || "Tags" };
    data.tagGroups.push(group);
    this.write(data);
    return group;
  }

  async renameTagGroup(id: string, name: string) {
    const n = name.trim();
    if (!n) return;
    const data = this.read();
    const idx = data.tagGroups.findIndex((g) => g.id === id);
    if (idx >= 0) {
      data.tagGroups[idx] = { ...data.tagGroups[idx], name: n };
      this.write(data);
    }
  }

  async deleteTagGroup(id: string) {
    const data = this.read();
    data.tagGroups = data.tagGroups.filter((g) => g.id !== id);
    // Cascade: drop this group's assignments across every asset.
    const tagAssignments: TagAssignments = {};
    for (const [assetId, byGroup] of Object.entries(data.tagAssignments)) {
      if (!(id in byGroup)) {
        tagAssignments[assetId] = byGroup;
        continue;
      }
      const nextByGroup = { ...byGroup };
      delete nextByGroup[id];
      if (Object.keys(nextByGroup).length) tagAssignments[assetId] = nextByGroup;
    }
    data.tagAssignments = tagAssignments;
    this.write(data);
  }

  async setAssetTags(assetId: string, groupId: string, values: string[]) {
    const data = this.read();
    const byGroup = data.tagAssignments[assetId] ?? {};
    const nextByGroup = { ...byGroup };
    if (values.length > 0) nextByGroup[groupId] = values;
    else delete nextByGroup[groupId];
    const tagAssignments = { ...data.tagAssignments };
    if (Object.keys(nextByGroup).length) tagAssignments[assetId] = nextByGroup;
    else delete tagAssignments[assetId];
    data.tagAssignments = tagAssignments;
    this.write(data);
  }

  async setAssetValuations(assetId: string, points: { date: string; value: number }[]) {
    const data = this.read();
    const others = data.valuationPoints.filter((p) => p.assetId !== assetId);
    data.valuationPoints = [...others, ...points.map((p) => ({ assetId, date: p.date, value: p.value }))];
    this.write(data);
  }

  async addAccount(input: AccountInput, id?: string) {
    const data = this.read();
    const account = { ...input, id: id ?? newId() };
    data.accounts.push(account);
    this.write(data);
    return account;
  }

  async updateAccount(id: string, patch: Partial<AccountInput>) {
    const data = this.read();
    const idx = data.accounts.findIndex((a) => a.id === id);
    if (idx >= 0) {
      data.accounts[idx] = { ...data.accounts[idx], ...patch };
      this.write(data);
    }
  }

  async deleteAccount(id: string) {
    const data = this.read();
    data.accounts = data.accounts.filter((a) => a.id !== id);
    // Cascade: balance readings belong to their account.
    data.accountBalances = data.accountBalances.filter((b) => b.accountId !== id);
    this.write(data);
  }

  async setAccountBalances(accountId: string, points: { date: string; balance: number }[]) {
    const data = this.read();
    const others = data.accountBalances.filter((b) => b.accountId !== accountId);
    data.accountBalances = [
      ...others,
      ...points.map((p) => ({ accountId, date: p.date, balance: p.balance })),
    ];
    this.write(data);
  }

  async saveLlmConfig(config: LlmConfig | null) {
    const data = this.read();
    data.llmConfig = config;
    this.write(data);
  }

  async createPortfolio(name: string, id?: string) {
    const data = this.read();
    if (data.portfolios.length >= MAX_PORTFOLIOS) {
      throw new Error(`You can have at most ${MAX_PORTFOLIOS} portfolios.`);
    }
    const portfolio = {
      id: id ?? newId(),
      name: name.trim() || "Portfolio",
      feeOrderFlat: 0,
      feeOrderFreeFrom: null,
      feeSavingsPlan: 0,
      taxAllowance: null,
    };
    data.portfolios.push(portfolio);
    this.write(data);
    return portfolio;
  }

  async renamePortfolio(id: string, name: string) {
    return this.updatePortfolio(id, { name });
  }

  async updatePortfolio(id: string, patch: PortfolioPatch) {
    const data = this.read();
    const idx = data.portfolios.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const p = data.portfolios[idx];
    data.portfolios[idx] = {
      ...p,
      ...(patch.name !== undefined ? { name: patch.name.trim() || p.name } : {}),
      ...(patch.feeOrderFlat !== undefined ? { feeOrderFlat: patch.feeOrderFlat } : {}),
      ...(patch.feeOrderFreeFrom !== undefined
        ? { feeOrderFreeFrom: patch.feeOrderFreeFrom }
        : {}),
      ...(patch.feeSavingsPlan !== undefined ? { feeSavingsPlan: patch.feeSavingsPlan } : {}),
      ...(patch.taxAllowance !== undefined ? { taxAllowance: patch.taxAllowance } : {}),
    };
    this.write(data);
  }

  async deletePortfolio(id: string) {
    const data = this.read();
    if (data.portfolios.length <= 1) return; // never remove the last portfolio
    data.portfolios = data.portfolios.filter((p) => p.id !== id);
    // Cascade: drop the portfolio's transactions, then any asset that was
    // held only through them (no transactions left in other portfolios).
    const doomed = new Set(
      data.transactions.filter((t) => t.portfolioId === id).map((t) => t.assetId),
    );
    const removedTxIds = data.transactions
      .filter((t) => t.portfolioId === id)
      .map((t) => t.id);
    data.transactions = data.transactions.filter((t) => t.portfolioId !== id);
    const stillUsed = new Set(data.transactions.map((t) => t.assetId));
    data.assets = data.assets.filter((a) => !doomed.has(a.id) || stillUsed.has(a.id));
    // Cascade savings plans of the deleted portfolio (and of assets it took).
    const assetIds = new Set(data.assets.map((a) => a.id));
    data.savingsPlans = data.savingsPlans.filter(
      (p) => p.portfolioId !== id && assetIds.has(p.assetId),
    );
    // Cascade tag assignments of assets removed along with the portfolio.
    const tagAssignments: TagAssignments = {};
    for (const [assetId, byGroup] of Object.entries(data.tagAssignments)) {
      if (assetIds.has(assetId)) tagAssignments[assetId] = byGroup;
    }
    data.tagAssignments = tagAssignments;
    // Cascade valuation points of assets removed along with the portfolio.
    data.valuationPoints = data.valuationPoints.filter((p) => assetIds.has(p.assetId));
    this.write(data);
    // Prune fingerprints for the removed transactions so re-importing the same
    // CSV after deleting a portfolio doesn't skip rows as "already imported".
    this.pruneImportedFingerprints(removedTxIds);
  }

  async loadSimulation(hash: string) {
    const map = this.readSims();
    return map[hash] ?? null;
  }

  async saveSimulation(entry: SimulationCacheEntry) {
    const map = this.readSims();
    map[entry.hash] = entry;
    // Cap the cache so localStorage can't grow without bound (keep newest 20).
    const entries = Object.values(map).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
    const trimmed: Record<string, SimulationCacheEntry> = {};
    for (const e of entries.slice(0, 20)) trimmed[e.hash] = e;
    try {
      this.storage.setItem(this.keys.simulations, JSON.stringify(trimmed));
    } catch {
      /* storage full — ignore, the sim just recomputes next time */
    }
  }

  private readSims(): Record<string, SimulationCacheEntry> {
    try {
      const raw = this.storage.getItem(this.keys.simulations);
      return raw ? (JSON.parse(raw) as Record<string, SimulationCacheEntry>) : {};
    } catch {
      return {};
    }
  }

  // fingerprint -> id of the transaction it created/merged into (null if
  // unknown, e.g. rows recorded before this link existed).
  private readImportRecord(): Record<string, string | null> {
    try {
      const raw = this.storage.getItem(this.keys.imported);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, string | null> | string[];
      // Tolerate the legacy bare fingerprint-array format.
      if (Array.isArray(parsed)) {
        return Object.fromEntries(parsed.map((f) => [f, null]));
      }
      return parsed;
    } catch {
      return {};
    }
  }

  private writeImportRecord(record: Record<string, string | null>): void {
    try {
      this.storage.setItem(this.keys.imported, JSON.stringify(record));
    } catch {
      /* storage full — ignore */
    }
  }

  /** Drops fingerprints tied to now-deleted transactions. */
  private pruneImportedFingerprints(removedTransactionIds: string[]): void {
    if (removedTransactionIds.length === 0) return;
    const removed = new Set(removedTransactionIds);
    const record = this.readImportRecord();
    let changed = false;
    for (const [fingerprint, transactionId] of Object.entries(record)) {
      if (transactionId != null && removed.has(transactionId)) {
        delete record[fingerprint];
        changed = true;
      }
    }
    if (changed) this.writeImportRecord(record);
  }

  async loadImportedFingerprints() {
    return Object.keys(this.readImportRecord());
  }

  async addImportedFingerprints(
    entries: { fingerprint: string; transactionId: string | null }[],
  ) {
    const record = this.readImportRecord();
    for (const e of entries) record[e.fingerprint] = e.transactionId;
    this.writeImportRecord(record);
  }
}

/** Exported so other store pieces (mutation-queue, offline-store) can share
 *  the same SSR/no-storage fallback shim. */
export function memoryStorageFallback(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}
