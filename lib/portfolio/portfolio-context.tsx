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
  type PortfolioData,
  type Profile,
  type Transaction,
} from "../types";
import { useAuth } from "../auth/auth-context";

interface PortfolioContextValue {
  data: PortfolioData;
  loading: boolean;
  persistent: boolean;
  reload(): Promise<void>;
  addAsset(input: AssetInput): Promise<Asset>;
  updateAsset(id: string, patch: Partial<AssetInput>): Promise<void>;
  deleteAsset(id: string): Promise<void>;
  addTransaction(input: TransactionInput): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  setCurrency(currency: string): Promise<void>;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<PortfolioData>(emptyPortfolio());
  const [loading, setLoading] = useState(true);

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

  const setCurrency = useCallback(
    async (currency: string) => {
      const profile: Profile = { ...data.profile, currency };
      await store.saveProfile(profile);
      setData((d) => ({ ...d, profile }));
    },
    [store, data.profile],
  );

  const value: PortfolioContextValue = {
    data,
    loading,
    persistent: store.persistent,
    reload,
    addAsset,
    updateAsset,
    deleteAsset,
    addTransaction,
    deleteTransaction,
    setCurrency,
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
