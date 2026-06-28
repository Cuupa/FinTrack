// Storage abstraction. The same interface is implemented twice:
//   - LocalStore   → browser storage (Guest Mode, PRD §2.1)
//   - SupabaseStore → Postgres via Supabase (Registered Mode, PRD §2.2)
// The active implementation is chosen by auth state in store/index.ts, so UI
// and finance code never branch on the mode.

import type { Asset, Portfolio, PortfolioData, Profile, Transaction } from "../types";

export type AssetInput = Omit<Asset, "id">;
export type TransactionInput = Omit<Transaction, "id">;

export interface DataStore {
  /** Whether this store persists across sessions/devices. */
  readonly persistent: boolean;
  load(): Promise<PortfolioData>;
  saveProfile(profile: Profile): Promise<void>;
  addAsset(input: AssetInput): Promise<Asset>;
  updateAsset(id: string, patch: Partial<AssetInput>): Promise<void>;
  deleteAsset(id: string): Promise<void>;
  addTransaction(input: TransactionInput): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  createPortfolio(name: string): Promise<Portfolio>;
  renamePortfolio(id: string, name: string): Promise<void>;
  deletePortfolio(id: string): Promise<void>;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
