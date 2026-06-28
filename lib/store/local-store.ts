// Guest Mode storage (PRD §2.1): everything lives in the browser. Data is
// lost when the user clears their browser storage — the UI surfaces this via
// the guest banner. Defaults to localStorage; pass sessionStorage for
// truly ephemeral sessions.

import { emptyPortfolio, type PortfolioData, type Profile } from "../types";
import type { AssetInput, DataStore, TransactionInput } from "./types";
import { newId } from "./types";

const STORAGE_KEY = "fintrack:portfolio:v1";

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
      return {
        // Merge over defaults so profiles saved before new fields (name, locale)
        // still have them.
        profile: { ...emptyPortfolio().profile, ...(parsed.profile ?? {}) },
        assets: parsed.assets ?? [],
        transactions: parsed.transactions ?? [],
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

  async deleteTransaction(id: string) {
    const data = this.read();
    data.transactions = data.transactions.filter((t) => t.id !== id);
    this.write(data);
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
