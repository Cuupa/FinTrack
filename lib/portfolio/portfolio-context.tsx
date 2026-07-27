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
  AccountInput,
  AssetInput,
  BudgetInput,
  ContractInput,
  PlannedCashflowInput,
  GoalInput,
  PortfolioPatch,
  SavingsPlanInput,
  SimulationCacheEntry,
  SpendingCategoryInput,
  SpendingTransactionInput,
  TransactionInput,
  WatchlistInput,
} from "../store/types";
import {
  emptyPortfolio,
  type Account,
  type Asset,
  type Budget,
  type Contract,
  type PlannedCashflow,
  type Goal,
  type LlmConfig,
  type Portfolio,
  type PortfolioData,
  type Profile,
  type SavingsPlan,
  type SpendingCategory,
  type SpendingTransaction,
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
  addAccount(input: AccountInput): Promise<Account>;
  updateAccount(id: string, patch: Partial<AccountInput>): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  /** Replace-set an account's dated balance readings. */
  setAccountBalances(accountId: string, points: { date: string; balance: number }[]): Promise<void>;
  setExtraRepayments(accountId: string, points: { date: string; amount: number }[]): Promise<void>;
  addSpendingCategory(input: SpendingCategoryInput): Promise<SpendingCategory>;
  updateSpendingCategory(id: string, patch: Partial<SpendingCategoryInput>): Promise<void>;
  deleteSpendingCategory(id: string): Promise<void>;
  addSpendingTransaction(input: SpendingTransactionInput): Promise<SpendingTransaction>;
  updateSpendingTransaction(id: string, patch: Partial<SpendingTransactionInput>): Promise<void>;
  deleteSpendingTransaction(id: string): Promise<void>;
  addBudget(input: BudgetInput): Promise<Budget>;
  updateBudget(id: string, patch: Partial<BudgetInput>): Promise<void>;
  deleteBudget(id: string): Promise<void>;
  addPlannedCashflow(input: PlannedCashflowInput): Promise<PlannedCashflow>;
  updatePlannedCashflow(id: string, patch: Partial<PlannedCashflowInput>): Promise<void>;
  deletePlannedCashflow(id: string): Promise<void>;
  addContract(input: ContractInput): Promise<Contract>;
  updateContract(id: string, patch: Partial<ContractInput>): Promise<void>;
  deleteContract(id: string): Promise<void>;
  addGoal(input: GoalInput): Promise<Goal>;
  updateGoal(id: string, patch: Partial<GoalInput>): Promise<void>;
  deleteGoal(id: string): Promise<void>;
  saveLlmConfig(config: LlmConfig | null): Promise<void>;
  setCurrency(currency: string): Promise<void>;
  updateProfile(patch: Partial<Profile>): Promise<void>;
  loadSimulation(hash: string): Promise<SimulationCacheEntry | null>;
  saveSimulation(entry: SimulationCacheEntry): Promise<void>;
  loadImportedFingerprints(): Promise<string[]>;
  addImportedFingerprints(
    entries: { fingerprint: string; transactionId: string | null }[],
  ): Promise<void>;
  loadImportedSpendingFingerprints(): Promise<string[]>;
  addImportedSpendingFingerprints(
    entries: { fingerprint: string; spendingTransactionId: string | null }[],
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

  const addAccount = useCallback(
    async (input: AccountInput) => {
      const account = await store.addAccount(input);
      setData((d) => ({ ...d, accounts: [...d.accounts, account] }));
      return account;
    },
    [store],
  );

  const updateAccount = useCallback(
    async (id: string, patch: Partial<AccountInput>) => {
      await store.updateAccount(id, patch);
      setData((d) => ({
        ...d,
        accounts: d.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },
    [store],
  );

  const deleteAccount = useCallback(
    async (id: string) => {
      await store.deleteAccount(id);
      setData((d) => ({
        ...d,
        accounts: d.accounts.filter((a) => a.id !== id),
        accountBalances: d.accountBalances.filter((b) => b.accountId !== id),
        extraRepayments: d.extraRepayments.filter((r) => r.accountId !== id),
        spendingTransactions: d.spendingTransactions.filter((t) => t.accountId !== id),
        // A goal keeps existing with no linked account (mirrors the DB's on delete set null).
        goals: d.goals.map((g) => (g.linkedAccountId === id ? { ...g, linkedAccountId: null } : g)),
        // Likewise a contract: it stops booking but stays in the register
        // (migration 0095's on delete set null).
        contracts: d.contracts.map((c) =>
          c.accountId === id ? { ...c, accountId: null, bookingStartDate: null } : c,
        ),
        // A planned cashflow cannot survive its account, that is where the money
        // lands and where its currency comes from (migration 0100 cascades).
        // Being the transfer TARGET is optional, so that one is only cleared.
        plannedCashflows: d.plannedCashflows
          .filter((p) => p.accountId !== id)
          .map((p) => (p.transferAccountId === id ? { ...p, transferAccountId: null } : p)),
      }));
    },
    [store],
  );

  const setAccountBalances = useCallback(
    async (accountId: string, points: { date: string; balance: number }[]) => {
      await store.setAccountBalances(accountId, points);
      setData((d) => {
        const others = d.accountBalances.filter((b) => b.accountId !== accountId);
        return {
          ...d,
          accountBalances: [
            ...others,
            ...points.map((p) => ({ accountId, date: p.date, balance: p.balance })),
          ],
        };
      });
    },
    [store],
  );

  const setExtraRepayments = useCallback(
    async (accountId: string, points: { date: string; amount: number }[]) => {
      await store.setExtraRepayments(accountId, points);
      setData((d) => {
        const others = d.extraRepayments.filter((r) => r.accountId !== accountId);
        return {
          ...d,
          extraRepayments: [
            ...others,
            ...points.map((p) => ({ accountId, date: p.date, amount: p.amount })),
          ],
        };
      });
    },
    [store],
  );

  const addSpendingCategory = useCallback(
    async (input: SpendingCategoryInput) => {
      const category = await store.addSpendingCategory(input);
      setData((d) => ({ ...d, spendingCategories: [...d.spendingCategories, category] }));
      return category;
    },
    [store],
  );

  const updateSpendingCategory = useCallback(
    async (id: string, patch: Partial<SpendingCategoryInput>) => {
      await store.updateSpendingCategory(id, patch);
      setData((d) => ({
        ...d,
        spendingCategories: d.spendingCategories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },
    [store],
  );

  const deleteSpendingCategory = useCallback(
    async (id: string) => {
      await store.deleteSpendingCategory(id);
      setData((d) => ({
        ...d,
        spendingCategories: d.spendingCategories.filter((c) => c.id !== id),
        spendingTransactions: d.spendingTransactions.map((t) =>
          t.categoryId === id ? { ...t, categoryId: null } : t,
        ),
        // A budget with no category means nothing (mirrors the DB's on delete cascade).
        budgets: d.budgets.filter((b) => b.categoryId !== id),
        // A contract keeps existing with no category (mirrors the DB's on delete set null).
        contracts: d.contracts.map((c) => (c.categoryId === id ? { ...c, categoryId: null } : c)),
        // Same for a planned cashflow: it still says when money arrives.
        plannedCashflows: d.plannedCashflows.map((p) =>
          p.categoryId === id ? { ...p, categoryId: null } : p,
        ),
      }));
    },
    [store],
  );

  const addSpendingTransaction = useCallback(
    async (input: SpendingTransactionInput) => {
      const transaction = await store.addSpendingTransaction(input);
      setData((d) => ({ ...d, spendingTransactions: [...d.spendingTransactions, transaction] }));
      return transaction;
    },
    [store],
  );

  const updateSpendingTransaction = useCallback(
    async (id: string, patch: Partial<SpendingTransactionInput>) => {
      await store.updateSpendingTransaction(id, patch);
      setData((d) => ({
        ...d,
        spendingTransactions: d.spendingTransactions.map((t) =>
          t.id === id ? { ...t, ...patch } : t,
        ),
      }));
    },
    [store],
  );

  const deleteSpendingTransaction = useCallback(
    async (id: string) => {
      await store.deleteSpendingTransaction(id);
      setData((d) => ({
        ...d,
        spendingTransactions: d.spendingTransactions.filter((t) => t.id !== id),
      }));
    },
    [store],
  );

  const addBudget = useCallback(
    async (input: BudgetInput) => {
      const budget = await store.addBudget(input);
      setData((d) => ({ ...d, budgets: [...d.budgets, budget] }));
      return budget;
    },
    [store],
  );

  const updateBudget = useCallback(
    async (id: string, patch: Partial<BudgetInput>) => {
      await store.updateBudget(id, patch);
      setData((d) => ({
        ...d,
        budgets: d.budgets.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }));
    },
    [store],
  );

  const deleteBudget = useCallback(
    async (id: string) => {
      await store.deleteBudget(id);
      setData((d) => ({ ...d, budgets: d.budgets.filter((b) => b.id !== id) }));
    },
    [store],
  );

  const addPlannedCashflow = useCallback(
    async (input: PlannedCashflowInput) => {
      const planned = await store.addPlannedCashflow(input);
      setData((d) => ({ ...d, plannedCashflows: [...d.plannedCashflows, planned] }));
      return planned;
    },
    [store],
  );

  const updatePlannedCashflow = useCallback(
    async (id: string, patch: Partial<PlannedCashflowInput>) => {
      await store.updatePlannedCashflow(id, patch);
      setData((d) => ({
        ...d,
        plannedCashflows: d.plannedCashflows.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }));
    },
    [store],
  );

  const deletePlannedCashflow = useCallback(
    async (id: string) => {
      await store.deletePlannedCashflow(id);
      setData((d) => ({
        ...d,
        plannedCashflows: d.plannedCashflows.filter((p) => p.id !== id),
        // The bookings it already posted stay in the ledger, they just lose the
        // link (mirrors the DB's on delete set null).
        spendingTransactions: d.spendingTransactions.map((t) =>
          t.plannedId === id ? { ...t, plannedId: null } : t,
        ),
      }));
    },
    [store],
  );

  const addContract = useCallback(
    async (input: ContractInput) => {
      const contract = await store.addContract(input);
      setData((d) => ({ ...d, contracts: [...d.contracts, contract] }));
      return contract;
    },
    [store],
  );

  const updateContract = useCallback(
    async (id: string, patch: Partial<ContractInput>) => {
      await store.updateContract(id, patch);
      setData((d) => ({
        ...d,
        contracts: d.contracts.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },
    [store],
  );

  const deleteContract = useCallback(
    async (id: string) => {
      await store.deleteContract(id);
      setData((d) => ({ ...d, contracts: d.contracts.filter((c) => c.id !== id) }));
    },
    [store],
  );

  const addGoal = useCallback(
    async (input: GoalInput) => {
      const goal = await store.addGoal(input);
      setData((d) => ({ ...d, goals: [...d.goals, goal] }));
      return goal;
    },
    [store],
  );

  const updateGoal = useCallback(
    async (id: string, patch: Partial<GoalInput>) => {
      await store.updateGoal(id, patch);
      setData((d) => ({
        ...d,
        goals: d.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)),
      }));
    },
    [store],
  );

  const deleteGoal = useCallback(
    async (id: string) => {
      await store.deleteGoal(id);
      // Sub-goals go with their parent, mirroring the DB's on delete cascade.
      setData((d) => ({
        ...d,
        goals: d.goals.filter((g) => g.id !== id && g.parentGoalId !== id),
      }));
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
  const loadImportedSpendingFingerprints = useCallback(
    () => store.loadImportedSpendingFingerprints(),
    [store],
  );
  const addImportedSpendingFingerprints = useCallback(
    (entries: { fingerprint: string; spendingTransactionId: string | null }[]) =>
      store.addImportedSpendingFingerprints(entries),
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
    addAccount,
    updateAccount,
    deleteAccount,
    setAccountBalances,
    setExtraRepayments,
    addSpendingCategory,
    updateSpendingCategory,
    deleteSpendingCategory,
    addSpendingTransaction,
    updateSpendingTransaction,
    deleteSpendingTransaction,
    addBudget,
    updateBudget,
    deleteBudget,
    addContract,
    updateContract,
    deleteContract,
    addPlannedCashflow,
    updatePlannedCashflow,
    deletePlannedCashflow,
    addGoal,
    updateGoal,
    deleteGoal,
    saveLlmConfig,
    setCurrency,
    updateProfile,
    loadSimulation,
    saveSimulation,
    loadImportedFingerprints,
    addImportedFingerprints,
    loadImportedSpendingFingerprints,
    addImportedSpendingFingerprints,
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
