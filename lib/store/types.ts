// Storage abstraction. The same interface is implemented twice:
//   - LocalStore   → browser storage (Guest Mode, PRD §2.1)
//   - SupabaseStore → Postgres via Supabase (Registered Mode, PRD §2.2)
// The active implementation is chosen by auth state in store/index.ts, so UI
// and finance code never branch on the mode.

import type {
  Asset,
  Portfolio,
  PortfolioData,
  Profile,
  SavingsPlan,
  Transaction,
  WatchlistItem,
} from "../types";

export type AssetInput = Omit<Asset, "id">;
export type TransactionInput = Omit<Transaction, "id">;
export type WatchlistInput = Omit<WatchlistItem, "id">;
export type SavingsPlanInput = Omit<SavingsPlan, "id">;

/** Patch shape for `DataStore.updatePortfolio` — every field optional, only
 *  the fields present are changed. `renamePortfolio` is a thin wrapper around
 *  this with just `{ name }`. */
export interface PortfolioPatch {
  name?: string;
  feeOrderFlat?: number;
  feeOrderFreeFrom?: number | null;
  feeSavingsPlan?: number;
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
