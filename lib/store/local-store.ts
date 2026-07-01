// Guest Mode storage (PRD §2.1): everything lives in the browser. Data is
// lost when the user clears their browser storage — the UI surfaces this via
// the guest banner. Defaults to localStorage; pass sessionStorage for
// truly ephemeral sessions.

import { emptyPortfolio, MAX_PORTFOLIOS, type PortfolioData, type Profile } from "../types";
import type { AssetInput, DataStore, SimulationCacheEntry, TransactionInput } from "./types";
import { newId } from "./types";

const STORAGE_KEY = "fintrack:portfolio:v1";
const SIM_KEY = "fintrack:simulations:v1";

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
    data.transactions = data.transactions.filter((t) => t.assetId !== id);
    this.write(data);
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
    // Reassign or drop orphaned transactions to the first remaining portfolio.
    const fallback = data.portfolios[0].id;
    data.transactions = data.transactions.map((t) =>
      t.portfolioId === id ? { ...t, portfolioId: fallback } : t,
    );
    this.write(data);
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
