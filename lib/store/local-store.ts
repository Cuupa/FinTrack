// Guest Mode storage (PRD §2.1): everything lives in the browser. Data is
// lost when the user clears their browser storage — the UI surfaces this via
// the guest banner. Defaults to localStorage; pass sessionStorage for
// truly ephemeral sessions.

import { emptyPortfolio, MAX_PORTFOLIOS, type PortfolioData, type Profile } from "../types";
import type { AssetInput, DataStore, SimulationCacheEntry, TransactionInput } from "./types";
import { newId } from "./types";

const STORAGE_KEY = "fintrack:portfolio:v1";
const SIM_KEY = "fintrack:simulations:v1";
const IMPORT_KEY = "fintrack:imported:v1";

export class LocalStore implements DataStore {
  readonly persistent = false;
  private storage: Storage;

  constructor(storage?: Storage) {
    // Fall back to an in-memory shim during SSR / when storage is unavailable.
    this.storage = storage ?? memoryStorageFallback();
  }

  private read(): PortfolioData {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return emptyPortfolio();
      const parsed = JSON.parse(raw) as PortfolioData;
      // Ensure at least one portfolio, and backfill transactions saved before
      // multi-portfolio (no portfolioId) to the default portfolio.
      const portfolios =
        parsed.portfolios && parsed.portfolios.length > 0
          ? parsed.portfolios
          : emptyPortfolio().portfolios;
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
        })),
      };
    } catch {
      return emptyPortfolio();
    }
  }

  private write(data: PortfolioData): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  async load(): Promise<PortfolioData> {
    return this.read();
  }

  async saveProfile(profile: Profile): Promise<void> {
    const data = this.read();
    data.profile = profile;
    this.write(data);
  }

  async addAsset(input: AssetInput) {
    const data = this.read();
    const asset = { ...input, id: newId() };
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
    this.write(data);
    this.pruneImportedFingerprints(removedIds);
  }

  async addTransaction(input: TransactionInput) {
    const data = this.read();
    const tx = { ...input, id: newId() };
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

  async createPortfolio(name: string) {
    const data = this.read();
    if (data.portfolios.length >= MAX_PORTFOLIOS) {
      throw new Error(`You can have at most ${MAX_PORTFOLIOS} portfolios.`);
    }
    const portfolio = { id: newId(), name: name.trim() || "Portfolio" };
    data.portfolios.push(portfolio);
    this.write(data);
    return portfolio;
  }

  async renamePortfolio(id: string, name: string) {
    const data = this.read();
    const p = data.portfolios.find((x) => x.id === id);
    if (p) {
      p.name = name.trim() || p.name;
      this.write(data);
    }
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
      this.storage.setItem(SIM_KEY, JSON.stringify(trimmed));
    } catch {
      /* storage full — ignore, the sim just recomputes next time */
    }
  }

  private readSims(): Record<string, SimulationCacheEntry> {
    try {
      const raw = this.storage.getItem(SIM_KEY);
      return raw ? (JSON.parse(raw) as Record<string, SimulationCacheEntry>) : {};
    } catch {
      return {};
    }
  }

  // fingerprint -> id of the transaction it created/merged into (null if
  // unknown, e.g. rows recorded before this link existed).
  private readImportRecord(): Record<string, string | null> {
    try {
      const raw = this.storage.getItem(IMPORT_KEY);
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
      this.storage.setItem(IMPORT_KEY, JSON.stringify(record));
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

function memoryStorageFallback(): Storage {
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
