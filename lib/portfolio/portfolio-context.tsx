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
import type {
  AssetInput,
  PortfolioPatch,
  SavingsPlanInput,
  SimulationCacheEntry,
  TransactionInput,
  WatchlistInput,
} from "../store/types";
import {
  emptyPortfolio,
  type Asset,
  type LlmConfig,
  type Portfolio,
  type PortfolioData,
  type Profile,
  type SavingsPlan,
  type TagAssignments,
  type TagGroup,
  type Transaction,
  type WatchlistItem,
} from "../types";
import { useAuth } from "../auth/auth-context";
import { useFeatureFlag } from "../flags/flags-context";
import { setManualValuations } from "../finance/manual-valuation";

interface PortfolioContextValue {
  /** Portfolio data scoped to the currently-selected portfolios. */
  data: PortfolioData;
  loading: boolean;
  /** True when the last load/reload attempt failed. Existing `data` is kept
   * as-is (never wiped) so a stale-but-present portfolio survives a failed
   * refresh; UI should show an error state and offer `reload()` instead of
   * hanging on the loading skeleton forever. */
  loadError: boolean;
  persistent: boolean;
  /**
   * The active store instance. Exposed so `SyncProvider`
   * (lib/offline/sync-context.tsx) can narrow it to `OfflineStore` and drive
   * its queue — the one deliberate exception to "UI/finance code never learn
   * about connectivity" (OFFLINE_DESIGN.md §3), since sync orchestration has
   * nowhere else to reach the store from. Everything else should keep using
   * the mutation methods below, not this directly.
   */
  store: DataStore;
  reload(): Promise<void>;
  addAsset(input: AssetInput): Promise<Asset>;
  updateAsset(id: string, patch: Partial<AssetInput>): Promise<void>;
  deleteAsset(id: string): Promise<void>;
  addTransaction(input: TransactionInput): Promise<Transaction>;
  updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  addWatchlistItem(input: WatchlistInput): Promise<WatchlistItem>;
  removeWatchlistItem(id: string): Promise<void>;
  updateWatchlistItem(id: string, patch: Partial<WatchlistInput>): Promise<void>;
  addSavingsPlan(input: SavingsPlanInput): Promise<SavingsPlan>;
  updateSavingsPlan(id: string, patch: Partial<SavingsPlanInput>): Promise<void>;
  deleteSavingsPlan(id: string): Promise<void>;
  addTagGroup(name: string): Promise<TagGroup>;
  renameTagGroup(id: string, name: string): Promise<void>;
  deleteTagGroup(id: string): Promise<void>;
  setAssetTags(assetId: string, groupId: string, values: string[]): Promise<void>;
  /** Replace-set an OTHER asset's manual valuation points. */
  setAssetValuations(assetId: string, points: { date: string; value: number }[]): Promise<void>;
  saveLlmConfig(config: LlmConfig | null): Promise<void>;
  setCurrency(currency: string): Promise<void>;
  updateProfile(patch: Partial<Profile>): Promise<void>;
  loadSimulation(hash: string): Promise<SimulationCacheEntry | null>;
  saveSimulation(entry: SimulationCacheEntry): Promise<void>;
  loadImportedFingerprints(): Promise<string[]>;
  addImportedFingerprints(
    entries: { fingerprint: string; transactionId: string | null }[],
  ): Promise<void>;
  /** All of the user's portfolios. */
  portfolios: Portfolio[];
  /** Every transaction (unscoped) — for building per-portfolio share snapshots. */
  allTransactions: Transaction[];
  /** Ids of the portfolios currently included in `data`. */
  selectedPortfolioIds: string[];
  setSelectedPortfolios(ids: string[]): void;
  createPortfolio(name: string): Promise<Portfolio>;
  renamePortfolio(id: string, name: string): Promise<void>;
  updatePortfolio(id: string, patch: PortfolioPatch): Promise<void>;
  deletePortfolio(id: string): Promise<void>;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<PortfolioData>(emptyPortfolio());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // null = all portfolios selected; otherwise the explicit selection.
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);

  // `createStore` is plain (called outside React) and can't read DB-backed
  // flags itself, so the `offline` flag is resolved here via the normal
  // hook (OFFLINE_DESIGN.md §2 phase 2) and threaded through, same as
  // `user.id`.
  const offlineEnabled = useFeatureFlag("offline");
  const store: DataStore = useMemo(
    () => createStore(getSupabaseClient(), user?.id ?? null, offlineEnabled),
    [user?.id, offlineEnabled],
  );

  const reload = useCallback(async () => {
    // A normal async callback (invoked from event handlers, e.g. a Retry
    // button), not a useEffect body, so setting state synchronously here is
    // fine — only effects are constrained to async continuations.
    setLoading(true);
    setLoadError(false);
    try {
      const loaded = await store.load();
      setData(loaded);
      setLoadError(false);
    } catch (err) {
      // Keep whatever `data` already holds — never fall back to an empty
      // portfolio on a failed refresh — and surface the failure instead.
      console.error("Failed to reload portfolio", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [store]);

  // Load whenever the active store changes (mount, sign-in, sign-out). State
  // is set in async continuations, never synchronously in the effect body
  // (Next 16's react-hooks/set-state-in-effect lint rule fails the build on
  // that) — clearing a stale error from a previous store is deferred via a
  // resolved-promise continuation, same trick as useOnlineStatus.
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setLoadError(false);
    });
    store.load().then(
      (loaded) => {
        if (!active) return;
        setData(loaded);
        setLoadError(false);
        setLoading(false);
      },
      (err: unknown) => {
        if (!active) return;
        // Same rule as `reload`: don't wipe existing data, just surface the
        // failure so the UI can stop hanging on the loading skeleton.
        console.error("Failed to load portfolio", err);
        setLoadError(true);
        setLoading(false);
      },
    );
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
      setData((d) => {
        const tagAssignments = { ...d.tagAssignments };
        delete tagAssignments[id];
        return {
          ...d,
          assets: d.assets.filter((a) => a.id !== id),
          transactions: d.transactions.filter((t) => t.assetId !== id),
          savingsPlans: d.savingsPlans.filter((p) => p.assetId !== id),
          tagAssignments,
        };
      });
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

  const addWatchlistItem = useCallback(
    async (input: WatchlistInput) => {
      const item = await store.addWatchlistItem(input);
      setData((d) => ({ ...d, watchlist: [...d.watchlist, item] }));
      return item;
    },
    [store],
  );

  const removeWatchlistItem = useCallback(
    async (id: string) => {
      await store.removeWatchlistItem(id);
      setData((d) => ({ ...d, watchlist: d.watchlist.filter((w) => w.id !== id) }));
    },
    [store],
  );

  const updateWatchlistItem = useCallback(
    async (id: string, patch: Partial<WatchlistInput>) => {
      await store.updateWatchlistItem(id, patch);
      setData((d) => ({
        ...d,
        watchlist: d.watchlist.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      }));
    },
    [store],
  );

  const addSavingsPlan = useCallback(
    async (input: SavingsPlanInput) => {
      const plan = await store.addSavingsPlan(input);
      setData((d) => ({ ...d, savingsPlans: [...d.savingsPlans, plan] }));
      return plan;
    },
    [store],
  );

  const updateSavingsPlan = useCallback(
    async (id: string, patch: Partial<SavingsPlanInput>) => {
      await store.updateSavingsPlan(id, patch);
      setData((d) => ({
        ...d,
        savingsPlans: d.savingsPlans.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }));
    },
    [store],
  );

  const deleteSavingsPlan = useCallback(
    async (id: string) => {
      await store.deleteSavingsPlan(id);
      setData((d) => ({
        ...d,
        savingsPlans: d.savingsPlans.filter((p) => p.id !== id),
      }));
    },
    [store],
  );

  const addTagGroup = useCallback(
    async (name: string) => {
      const group = await store.addTagGroup(name);
      setData((d) => ({ ...d, tagGroups: [...d.tagGroups, group] }));
      return group;
    },
    [store],
  );

  const renameTagGroup = useCallback(
    async (id: string, name: string) => {
      await store.renameTagGroup(id, name);
      const n = name.trim();
      if (!n) return;
      setData((d) => ({
        ...d,
        tagGroups: d.tagGroups.map((g) => (g.id === id ? { ...g, name: n } : g)),
      }));
    },
    [store],
  );

  const deleteTagGroup = useCallback(
    async (id: string) => {
      await store.deleteTagGroup(id);
      setData((d) => {
        const tagGroups = d.tagGroups.filter((g) => g.id !== id);
        const tagAssignments: TagAssignments = {};
        for (const [assetId, byGroup] of Object.entries(d.tagAssignments)) {
          if (!(id in byGroup)) {
            tagAssignments[assetId] = byGroup;
            continue;
          }
          const nextByGroup = { ...byGroup };
          delete nextByGroup[id];
          if (Object.keys(nextByGroup).length) tagAssignments[assetId] = nextByGroup;
        }
        return { ...d, tagGroups, tagAssignments };
      });
    },
    [store],
  );

  const setAssetTags = useCallback(
    async (assetId: string, groupId: string, values: string[]) => {
      await store.setAssetTags(assetId, groupId, values);
      setData((d) => {
        const byGroup = d.tagAssignments[assetId] ?? {};
        const nextByGroup = { ...byGroup };
        if (values.length > 0) nextByGroup[groupId] = values;
        else delete nextByGroup[groupId];
        const tagAssignments = { ...d.tagAssignments };
        if (Object.keys(nextByGroup).length) tagAssignments[assetId] = nextByGroup;
        else delete tagAssignments[assetId];
        return { ...d, tagAssignments };
      });
    },
    [store],
  );

  const setAssetValuations = useCallback(
    async (assetId: string, points: { date: string; value: number }[]) => {
      await store.setAssetValuations(assetId, points);
      setData((d) => {
        const others = d.valuationPoints.filter((p) => p.assetId !== assetId);
        return {
          ...d,
          valuationPoints: [
            ...others,
            ...points.map((p) => ({ assetId, date: p.date, value: p.value })),
          ],
        };
      });
    },
    [store],
  );

  const saveLlmConfig = useCallback(
    async (config: LlmConfig | null) => {
      await store.saveLlmConfig(config);
      setData((d) => ({ ...d, llmConfig: config }));
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

  const updatePortfolio = useCallback(
    async (id: string, patch: PortfolioPatch) => {
      await store.updatePortfolio(id, patch);
      setData((d) => ({
        ...d,
        portfolios: d.portfolios.map((p) => (p.id === id ? { ...p, ...patch } : p)),
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

  const loadSimulation = useCallback((hash: string) => store.loadSimulation(hash), [store]);
  const saveSimulation = useCallback(
    (entry: SimulationCacheEntry) => store.saveSimulation(entry),
    [store],
  );
  const loadImportedFingerprints = useCallback(() => store.loadImportedFingerprints(), [store]);
  const addImportedFingerprints = useCallback(
    (entries: { fingerprint: string; transactionId: string | null }[]) =>
      store.addImportedFingerprints(entries),
    [store],
  );

  // Feed OTHER assets' manual valuation points into the PriceProvider seam's
  // registry (lib/finance/manual-valuation.ts), which prices.ts reads
  // synchronously — exactly like the catalog cache. Done in a render-time
  // useMemo (not an effect) so the parent updates the registry BEFORE any
  // child renders and calls the finance layer, guaranteeing they read fresh
  // values without threading a version through every memo. Idempotent.
  useMemo(
    () => setManualValuations(data.assets, data.valuationPoints),
    [data.assets, data.valuationPoints],
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
    loadError,
    persistent: store.persistent,
    store,
    reload,
    addAsset,
    updateAsset,
    deleteAsset,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addWatchlistItem,
    removeWatchlistItem,
    updateWatchlistItem,
    addSavingsPlan,
    updateSavingsPlan,
    deleteSavingsPlan,
    addTagGroup,
    renameTagGroup,
    deleteTagGroup,
    setAssetTags,
    setAssetValuations,
    saveLlmConfig,
    setCurrency,
    updateProfile,
    loadSimulation,
    saveSimulation,
    loadImportedFingerprints,
    addImportedFingerprints,
    portfolios: data.portfolios,
    allTransactions: data.transactions,
    selectedPortfolioIds: activeIds,
    setSelectedPortfolios: setSelectedIds,
    createPortfolio,
    renamePortfolio,
    updatePortfolio,
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
