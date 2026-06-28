// Core domain types shared across the app and both storage backends.

export type AssetType = "ETF" | "STOCK" | "CRYPTO" | "CASH";
export type TransactionType = "BUY" | "SELL";

export const ASSET_TYPES: AssetType[] = ["ETF", "STOCK", "CRYPTO", "CASH"];

/** Per-user configuration (PRD: `profiles`). */
export interface Profile {
  /** ISO 4217 base currency for all displayed values, e.g. "EUR". */
  currency: string;
  /** Display name / nickname, shown in the UI and on shared portfolios. */
  name: string | null;
  /** Preferred UI locale ("en" | "de"); null = use the device/last choice. */
  locale: string | null;
}

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
}

/**
 * Stable key used to look up prices for an asset. Prefers ISIN, then WKN, then
 * symbol, then name — so two assets that share an ISIN share a price series.
 */
export function assetPriceKey(asset: Asset): string {
  return (asset.isin || asset.wkn || asset.symbol || asset.name || "").toUpperCase();
}

/** Human-facing identifier shown in tables and headers. */
export function assetIdentifier(asset: Asset): string {
  if (asset.wkn && asset.isin) return `${asset.wkn} · ${asset.isin}`;
  return asset.isin || asset.wkn || asset.symbol || "—";
}

/** A buy or sell event (PRD: `transactions`). */
export interface Transaction {
  id: string;
  assetId: string;
  type: TransactionType;
  /** Number of shares/units (always positive; direction comes from `type`). */
  quantity: number;
  /** Price per unit in the base currency. */
  price: number;
  /** Transaction fee in the base currency. */
  fee: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
}

/** The complete persisted state for one user (or guest session). */
export interface PortfolioData {
  profile: Profile;
  assets: Asset[];
  transactions: Transaction[];
}

export const DEFAULT_PROFILE: Profile = { currency: "EUR", name: null, locale: null };

export function emptyPortfolio(): PortfolioData {
  return { profile: { ...DEFAULT_PROFILE }, assets: [], transactions: [] };
}
