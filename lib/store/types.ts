// Storage abstraction. The same interface is implemented twice:
//   - LocalStore   → browser storage (Guest Mode, PRD §2.1)
//   - SupabaseStore → Postgres via Supabase (Registered Mode, PRD §2.2)
// The active implementation is chosen by auth state in store/index.ts, so UI
// and finance code never branch on the mode.

import type { Asset, Portfolio, PortfolioData, Profile, Transaction } from "../types";

export type AssetInput = Omit<Asset, "id">;
export type TransactionInput = Omit<Transaction, "id">;

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
  addAsset(input: AssetInput): Promise<Asset>;
  updateAsset(id: string, patch: Partial<AssetInput>): Promise<void>;
  deleteAsset(id: string): Promise<void>;
  addTransaction(input: TransactionInput): Promise<Transaction>;
  updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  createPortfolio(name: string): Promise<Portfolio>;
  renamePortfolio(id: string, name: string): Promise<void>;
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
}

export function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
