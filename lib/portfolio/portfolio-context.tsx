"use client";

// Holds the active portfolio in memory and exposes mutations. Backed by the
// store chosen from auth state, so switching between Guest and Registered mode
// transparently swaps localStorage for Supabase and reloads.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getSupabaseClient } from "../supabase/client";
import { createStore, type DataStore } from "../store";
import type { AssetInput, TransactionInput } from "../store/types";
import {
  emptyPortfolio,
  type Asset,
  type Portfolio,
  type PortfolioData,
  type Profile,
  type Transaction,
} from "../types";
import { useAuth } from "../auth/auth-context";

interface PortfolioContextValue {
  /** Portfolio data scoped to the currently-selected portfolios. */
  data: PortfolioData;
  loading: boolean;
  persistent: boolean;
  reload(): Promise<void>;
  addAsset(input: AssetInput): Promise<Asset>;
  updateAsset(id: string, patch: Partial<AssetInput>): Promise<void>;
  deleteAsset(id: string): Promise<void>;
  addTransaction(input: TransactionInput): Promise<Transaction>;
  updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  setCurrency(currency: string): Promise<void>;
  updateProfile(patch: Partial<Profile>): Promise<void>;
  /** All of the user's portfolios. */
  portfolios: Portfolio[];
  /** Every transaction (unscoped) — for building per-portfolio share snapshots. */
  allTransactions: Transaction[];
  /** Ids of the portfolios currently included in `data`. */
  selectedPortfolioIds: string[];
  setSelectedPortfolios(ids: string[]): void;
  createPortfolio(name: string): Promise<Portfolio>;
  renamePortfolio(id: string, name: string): Promise<void>;
  deletePortfolio(id: string): Promise<void>;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<PortfolioData>(emptyPortfolio());
  const [loading, setLoading] = useState(true);
  // null = all portfolios selected; otherwise the explicit selection.
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);

  const store: DataStore = useMemo(
    () => createStore(getSupabaseClient(), user?.id ?? null),
    [user?.id],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await store.load());
    } finally {
      setLoading(false);
    }
  }, [store]);

  // Load whenever the active store changes (mount, sign-in, sign-out). State
  // is set in the async continuation, after awaiting the external store.
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    store.load().then((loaded) => {
      if (!active) return;
      setData(loaded);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [authLoading, store]);

  const addAsset = useCallback(
    async (input: AssetInput) => {
      const asset = await store.addAsset(input);
      setData((d) => ({ ...d, assets: [...d.assets, asset] }));
      return asset;
    },
    [store],
  );

  const updateAsset = useCallback(
    async (id: string, patch: Partial<AssetInput>) => {
      await store.updateAsset(id, patch);
      setData((d) => ({
        ...d,
        assets: d.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },
    [store],
  );

  const deleteAsset = useCallback(
    async (id: string) => {
      await store.deleteAsset(id);
      setData((d) => ({
        ...d,
        assets: d.assets.filter((a) => a.id !== id),
        transactions: d.transactions.filter((t) => t.assetId !== id),
      }));
    },
    [store],
  );

  const addTransaction = useCallback(
    async (input: TransactionInput) => {
      const tx = await store.addTransaction(input);
      setData((d) => ({ ...d, transactions: [...d.transactions, tx] }));
      return tx;
    },
    [store],
  );

  const updateTransaction = useCallback(
    async (id: string, patch: Partial<TransactionInput>) => {
      await store.updateTransaction(id, patch);
      setData((d) => ({
        ...d,
        transactions: d.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }));
    },
    [store],
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      await store.deleteTransaction(id);
      setData((d) => ({
        ...d,
        transactions: d.transactions.filter((t) => t.id !== id),
      }));
    },
    [store],
  );

  const updateProfile = useCallback(
    async (patch: Partial<Profile>) => {
      const profile: Profile = { ...data.profile, ...patch };
      await store.saveProfile(profile);
      setData((d) => ({ ...d, profile }));
    },
    [store, data.profile],
  );

  const setCurrency = useCallback(
    (currency: string) => updateProfile({ currency }),
    [updateProfile],
  );

  const createPortfolio = useCallback(
    async (name: string) => {
      const p = await store.createPortfolio(name);
      setData((d) => ({ ...d, portfolios: [...d.portfolios, p] }));
      // Auto-include a newly created portfolio in an explicit selection.
      setSelectedIds((prev) => (prev === null ? null : [...prev, p.id]));
      return p;
    },
    [store],
  );

  const renamePortfolio = useCallback(
    async (id: string, name: string) => {
      await store.renamePortfolio(id, name);
      setData((d) => ({
        ...d,
        portfolios: d.portfolios.map((p) => (p.id === id ? { ...p, name } : p)),
      }));
    },
    [store],
  );

  const deletePortfolio = useCallback(
    async (id: string) => {
      await store.deletePortfolio(id);
      setSelectedIds((prev) => (prev === null ? null : prev.filter((x) => x !== id)));
      await reload(); // transactions may have been reassigned
    },
    [store, reload],
  );

  const allIds = data.portfolios.map((p) => p.id);
  const activeIds = selectedIds ?? allIds;
  const activeKey = activeIds.join(",");
  // Scope the data to the selected portfolios — every downstream view computes
  // off `data.transactions`, so this is the single place portfolios are applied.
  const scopedData = useMemo<PortfolioData>(
    () => ({
      ...data,
      transactions: data.transactions.filter((t) => activeIds.includes(t.portfolioId)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, activeKey],
  );

  const value: PortfolioContextValue = {
    data: scopedData,
    loading,
    persistent: store.persistent,
    reload,
    addAsset,
    updateAsset,
    deleteAsset,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    setCurrency,
    updateProfile,
    portfolios: data.portfolios,
    allTransactions: data.transactions,
    selectedPortfolioIds: activeIds,
    setSelectedPortfolios: setSelectedIds,
    createPortfolio,
    renamePortfolio,
    deletePortfolio,
  };

  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio(): PortfolioContextValue {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error("usePortfolio must be used within PortfolioProvider");
  return ctx;
}

export type { Transaction };
