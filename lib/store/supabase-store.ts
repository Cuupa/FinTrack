// Registered Mode storage (PRD §2.2): full persistence in Supabase Postgres
// with per-user row-level security.
//
// The schema is normalized (3NF): an `asset` is a link from a user to an
// `instrument` (which holds the master data) plus notes; `transactions` have
// no user_id (ownership derives from the asset). This store maps between those
// normalized tables and the app's denormalized in-memory Asset/Transaction
// shapes, so the rest of the app is unaffected.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PROFILE,
  EMPTY_REBALANCE_PLAN,
  MAX_PORTFOLIOS,
  type Account,
  type AccountBalance,
  type AccountKind,
  type Asset,
  type Budget,
  type Contract,
  type Goal,
  type LlmConfig,
  type Portfolio,
  type PortfolioData,
  type Profile,
  type RebalancePlan,
  type SavingsPlan,
  type SpendingCategory,
  type SpendingTransaction,
  type TagAssignments,
  type TagGroup,
  type Transaction,
  type ValuationPoint,
  type WatchlistItem,
} from "../types";

/** Coerce a jsonb `rebalance_targets` value (which may be `{}` from the column
 *  default, null, or a partial object) into a complete RebalancePlan. */
function normalizeRebalancePlan(raw: unknown): RebalancePlan {
  if (!raw || typeof raw !== "object") return { ...EMPTY_REBALANCE_PLAN };
  const r = raw as Partial<RebalancePlan>;
  return {
    mode: r.mode === "buyOnly" ? "buyOnly" : "trade",
    weights:
      r.weights && typeof r.weights === "object" ? (r.weights as Record<string, number>) : {},
    custom: Array.isArray(r.custom) ? r.custom : [],
  };
}
import type { LlmProviderId } from "../llm/types";
import { RowNotFoundError } from "./types";
import type {
  AccountInput,
  AssetInput,
  BudgetInput,
  ContractInput,
  DataStore,
  GoalInput,
  PortfolioPatch,
  SavingsPlanInput,
  SimulationCacheEntry,
  SpendingCategoryInput,
  SpendingTransactionInput,
  TransactionInput,
  WatchlistInput,
} from "./types";

interface PortfolioRow {
  id: string;
  name: string;
  fee_order_flat: number | string | null;
  fee_order_free_from: number | string | null;
  fee_savings_plan: number | string | null;
  tax_allowance: number | string | null;
}

function portfolioFromRow(r: PortfolioRow): Portfolio {
  return {
    id: r.id,
    name: r.name,
    feeOrderFlat: r.fee_order_flat != null ? Number(r.fee_order_flat) : 0,
    feeOrderFreeFrom: r.fee_order_free_from != null ? Number(r.fee_order_free_from) : null,
    feeSavingsPlan: r.fee_savings_plan != null ? Number(r.fee_savings_plan) : 0,
    taxAllowance: r.tax_allowance != null ? Number(r.tax_allowance) : null,
  };
}

interface InstrumentEmbed {
  isin: string | null;
  wkn: string | null;
  symbol: string | null;
  name: string;
  type: Asset["type"];
  currency: string | null;
}

interface AssetRow {
  id: string;
  notes: string | null;
  currency: string | null;
  interest_rate: number | null;
  interest_frequency: Asset["interestFrequency"] | null;
  interest_post_day: Asset["interestPostDay"] | null;
  instrument: InstrumentEmbed | InstrumentEmbed[] | null;
}

interface TxRow {
  id: string;
  asset_id: string;
  portfolio_id: string | null;
  type: Transaction["type"];
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  executed_at: string;
}

interface SavingsPlanRow {
  id: string;
  asset_id: string;
  portfolio_id: string;
  amount: number;
  frequency: SavingsPlan["interval"];
  booking_type: string | null;
  start_date: string;
  active: boolean;
  last_run_date: string | null;
}

function planFromRow(r: SavingsPlanRow): SavingsPlan {
  return {
    id: r.id,
    assetId: r.asset_id,
    portfolioId: r.portfolio_id,
    amount: Number(r.amount),
    interval: r.frequency,
    bookingType: r.booking_type === "BOOKING" ? "BOOKING" : "BUY",
    startDate: r.start_date,
    active: r.active,
    lastRunDate: r.last_run_date,
  };
}

interface AccountRow {
  id: string;
  name: string;
  kind: string;
  currency: string | null;
  is_liability: boolean;
  opening_balance: number | string | null;
  opened_on: string;
  interest_rate: number | string | null;
  min_payment: number | string | null;
}

function accountFromRow(r: AccountRow): Account {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as AccountKind,
    currency: r.currency,
    isLiability: !!r.is_liability,
    openingBalance: r.opening_balance != null ? Number(r.opening_balance) : 0,
    openedOn: r.opened_on,
    interestRate: r.interest_rate != null ? Number(r.interest_rate) : null,
    minPayment: r.min_payment != null ? Number(r.min_payment) : null,
  };
}

interface SpendingCategoryRow {
  id: string;
  group_name: string;
  name: string;
  tax_deductible: boolean | null;
}

function spendingCategoryFromRow(r: SpendingCategoryRow): SpendingCategory {
  return {
    id: r.id,
    groupName: r.group_name,
    name: r.name,
    taxDeductible: r.tax_deductible ?? undefined,
  };
}

interface SpendingTransactionRow {
  id: string;
  account_id: string;
  category_id: string | null;
  date: string;
  amount: number | string;
  payee: string;
  note: string | null;
  recurring_id: string | null;
  // Migration 0096; optional so a database that has not run it still loads.
  transfer_account_id?: string | null;
}

function spendingTransactionFromRow(r: SpendingTransactionRow): SpendingTransaction {
  return {
    id: r.id,
    accountId: r.account_id,
    categoryId: r.category_id,
    date: r.date,
    amount: Number(r.amount),
    payee: r.payee,
    note: r.note,
    recurringId: r.recurring_id,
    transferAccountId: r.transfer_account_id ?? null,
  };
}

interface BudgetRow {
  id: string;
  category_id: string;
  amount: number | string;
}

function budgetFromRow(r: BudgetRow): Budget {
  return { id: r.id, categoryId: r.category_id, amount: Number(r.amount) };
}

interface ContractRow {
  id: string;
  name: string;
  amount: number | string;
  interval: string;
  renewal_date: string | null;
  cancellation_notice_days: number | null;
  category_id: string | null;
  insurance_type: string | null;
  sum_insured: number | string | null;
  // Migration 0095. Optional on the row type so a database that has not run
  // it yet still deserialises instead of throwing.
  account_id?: string | null;
  booking_start_date?: string | null;
  last_booked_date?: string | null;
  target_account_id?: string | null;
}

function contractFromRow(r: ContractRow): Contract {
  return {
    id: r.id,
    name: r.name,
    amount: Number(r.amount),
    interval: r.interval as Contract["interval"],
    renewalDate: r.renewal_date,
    cancellationNoticeDays: r.cancellation_notice_days,
    categoryId: r.category_id,
    insuranceType: r.insurance_type as Contract["insuranceType"],
    sumInsured: r.sum_insured != null ? Number(r.sum_insured) : null,
    accountId: r.account_id ?? null,
    bookingStartDate: r.booking_start_date ?? null,
    lastBookedDate: r.last_booked_date ?? null,
    targetAccountId: r.target_account_id ?? null,
  };
}

interface GoalRow {
  id: string;
  name: string;
  target_amount: number | string;
  target_date: string | null;
  linked_account_id: string | null;
  manual_current_amount: number | string | null;
  // Optional: a DB that predates migration 0097 doesn't return these.
  tracks_investments?: boolean | null;
  linked_portfolio_id?: string | null;
}

function goalFromRow(r: GoalRow): Goal {
  return {
    id: r.id,
    name: r.name,
    targetAmount: Number(r.target_amount),
    targetDate: r.target_date,
    linkedAccountId: r.linked_account_id,
    manualCurrentAmount: r.manual_current_amount != null ? Number(r.manual_current_amount) : null,
    // Defaulted, so a DB that predates migration 0097 reads as "account or
    // manual" exactly like before.
    tracksInvestments: r.tracks_investments ?? false,
    linkedPortfolioId: r.linked_portfolio_id ?? null,
  };
}

function embed(row: AssetRow): InstrumentEmbed | null {
  const i = row.instrument;
  return Array.isArray(i) ? (i[0] ?? null) : i;
}

export class SupabaseStore implements DataStore {
  readonly persistent = true;

  constructor(
    private supabase: SupabaseClient,
    private userId: string,
  ) {}

  async load(): Promise<PortfolioData> {
    const [
      profileRes,
      portfoliosRes,
      assetsRes,
      txRes,
      watchRes,
      plansRes,
      tagGroupsRes,
      assetTagsRes,
      valuationsRes,
      accountsRes,
      accountBalancesRes,
      spendingCategoriesRes,
      spendingTransactionsRes,
      budgetsRes,
      contractsRes,
      goalsRes,
      llmSettingsRes,
    ] = await Promise.all([
      this.supabase
        .from("profiles")
        .select(
          "currency, display_name, locale, theme, tax_allowance, church_tax_rate, tax_teilfreistellung, tax_vorabpauschale, tax_withheld_override, tour_done_at, tours_done, rebalance_targets",
        )
        .eq("id", this.userId)
        .maybeSingle(),
      // Household-shared tables (migrations 0092/0093): no explicit
      // .eq("user_id", ...) filter — RLS alone decides which rows are
      // visible, so a household peer's rows are included automatically
      // without the store needing to know about households at all.
      // llm_settings/profiles (below) deliberately stay self-only.
      this.supabase
        .from("portfolios")
        .select("id, name, fee_order_flat, fee_order_free_from, fee_savings_plan, tax_allowance")
        .order("created_at", { ascending: true }),
      this.supabase
        .from("assets")
        .select(
          "id, notes, currency, interest_rate, interest_frequency, interest_post_day, instrument:instruments (isin, wkn, symbol, name, type, currency)",
        ),
      // RLS scopes transactions to the user's (or a household peer's) assets
      // — no user_id column of its own.
      this.supabase
        .from("transactions")
        .select("id, asset_id, portfolio_id, type, quantity, price, fee, tax, executed_at"),
      this.supabase
        .from("watchlist_items")
        .select("id, currency, instrument:instruments (isin, wkn, symbol, name, type, currency)")
        .order("created_at", { ascending: true }),
      this.supabase
        .from("savings_plans")
        .select("id, asset_id, portfolio_id, amount, frequency, booking_type, start_date, active, last_run_date")
        .order("created_at", { ascending: true }),
      this.supabase
        .from("tag_groups")
        .select("id, name")
        .order("created_at", { ascending: true }),
      this.supabase
        .from("asset_tags")
        .select("asset_id, group_id, value"),
      this.supabase
        .from("asset_valuations")
        .select("asset_id, valued_on, value")
        .order("valued_on", { ascending: true }),
      this.supabase
        .from("accounts")
        .select(
          "id, name, kind, currency, is_liability, opening_balance, opened_on, interest_rate, min_payment",
        )
        .order("created_at", { ascending: true }),
      this.supabase
        .from("account_balances")
        .select("account_id, balance_on, balance")
        .order("balance_on", { ascending: true }),
      this.supabase
        .from("spending_categories")
        .select("id, group_name, name, tax_deductible")
        .order("created_at", { ascending: true }),
      this.supabase
        .from("spending_transactions")
        .select("id, account_id, category_id, date, amount, payee, note, recurring_id, transfer_account_id")
        .order("date", { ascending: false }),
      this.supabase
        .from("budgets")
        .select("id, category_id, amount")
        .order("created_at", { ascending: true }),
      this.supabase
        .from("contracts")
        .select(
          "id, name, amount, interval, renewal_date, cancellation_notice_days, category_id, insurance_type, sum_insured",
        )
        .order("created_at", { ascending: true }),
      this.supabase
        .from("goals")
        .select(
          "id, name, target_amount, target_date, linked_account_id, manual_current_amount, tracks_investments, linked_portfolio_id",
        )
        .order("created_at", { ascending: true }),
      // Personal, never household-shared (see migration 0093's comment).
      this.supabase
        .from("llm_settings")
        .select("provider, model, api_key")
        .eq("user_id", this.userId)
        .maybeSingle(),
    ]);

    // Profile errors were previously swallowed, silently resetting the whole
    // profile (currency, tax settings, theme, tour state) to defaults whenever
    // the SELECT failed — e.g. a profile column that lags its migration. Fail
    // loud like every sibling resource so the load surfaces a retryable error
    // instead of quietly discarding the user's settings.
    if (profileRes.error) throw profileRes.error;
    if (assetsRes.error) throw assetsRes.error;
    if (txRes.error) throw txRes.error;
    if (watchRes.error) throw watchRes.error;
    if (plansRes.error) throw plansRes.error;
    if (tagGroupsRes.error) throw tagGroupsRes.error;
    if (assetTagsRes.error) throw assetTagsRes.error;
    if (valuationsRes.error) throw valuationsRes.error;
    if (accountsRes.error) throw accountsRes.error;
    if (accountBalancesRes.error) throw accountBalancesRes.error;
    if (spendingCategoriesRes.error) throw spendingCategoriesRes.error;
    if (spendingTransactionsRes.error) throw spendingTransactionsRes.error;
    if (budgetsRes.error) throw budgetsRes.error;
    if (contractsRes.error) throw contractsRes.error;
    if (goalsRes.error) throw goalsRes.error;
    if (llmSettingsRes.error) throw llmSettingsRes.error;

    // Ensure the user has at least one portfolio (creating a default for
    // pre-multi-portfolio accounts) and backfill orphaned transactions.
    let portfolios: Portfolio[] = ((portfoliosRes.data ?? []) as PortfolioRow[]).map(
      portfolioFromRow,
    );
    if (portfolios.length === 0) {
      const def = await this.createPortfolio("Main");
      portfolios = [def];
      await this.supabase
        .from("transactions")
        .update({ portfolio_id: def.id })
        .is("portfolio_id", null);
    }
    const fallbackId = portfolios[0].id;

    const profile: Profile = profileRes.data
      ? {
          currency: profileRes.data.currency,
          name: profileRes.data.display_name ?? null,
          locale: profileRes.data.locale ?? null,
          theme:
            profileRes.data.theme === "light" || profileRes.data.theme === "dark"
              ? profileRes.data.theme
              : null,
          taxAllowance: profileRes.data.tax_allowance ?? DEFAULT_PROFILE.taxAllowance,
          churchTaxRate: profileRes.data.church_tax_rate ?? DEFAULT_PROFILE.churchTaxRate,
          taxTeilfreistellung:
            profileRes.data.tax_teilfreistellung ?? DEFAULT_PROFILE.taxTeilfreistellung,
          taxVorabpauschale:
            profileRes.data.tax_vorabpauschale ?? DEFAULT_PROFILE.taxVorabpauschale,
          taxWithheldOverride:
            profileRes.data.tax_withheld_override ?? DEFAULT_PROFILE.taxWithheldOverride,
          tourDoneAt:
            typeof profileRes.data.tour_done_at === "string" ? profileRes.data.tour_done_at : null,
          toursDone: profileRes.data.tours_done ?? DEFAULT_PROFILE.toursDone,
          rebalanceTargets: normalizeRebalancePlan(profileRes.data.rebalance_targets),
        }
      : { ...DEFAULT_PROFILE };

    const assets: Asset[] = ((assetsRes.data ?? []) as AssetRow[]).map((r) => {
      const inst = embed(r);
      return {
        id: r.id,
        isin: inst?.isin ?? null,
        wkn: inst?.wkn ?? null,
        symbol: inst?.symbol ?? null,
        name: inst?.name ?? "",
        type: inst?.type ?? "STOCK",
        // The user's own trading currency wins; fall back to the instrument's.
        currency: r.currency ?? inst?.currency ?? null,
        notes: r.notes,
        interestRate: r.interest_rate,
        interestFrequency: r.interest_frequency,
        interestPostDay: r.interest_post_day,
      };
    });

    const transactions: Transaction[] = ((txRes.data ?? []) as TxRow[]).map((r) => ({
      id: r.id,
      assetId: r.asset_id,
      portfolioId: r.portfolio_id ?? fallbackId,
      type: r.type,
      quantity: Number(r.quantity),
      price: Number(r.price),
      fee: Number(r.fee),
      tax: Number(r.tax ?? 0),
      date: r.executed_at,
    }));

    const watchlist: WatchlistItem[] = (
      (watchRes.data ?? []) as Pick<AssetRow, "id" | "currency" | "instrument">[]
    ).map((r) => {
      const inst = embed(r as AssetRow);
      return {
        id: r.id,
        isin: inst?.isin ?? null,
        wkn: inst?.wkn ?? null,
        symbol: inst?.symbol ?? null,
        name: inst?.name ?? "",
        type: inst?.type ?? "STOCK",
        // The user's own override wins; fall back to the instrument's.
        currency: r.currency ?? inst?.currency ?? null,
      };
    });

    const savingsPlans: SavingsPlan[] = ((plansRes.data ?? []) as SavingsPlanRow[]).map(
      planFromRow,
    );

    const tagGroups: TagGroup[] = ((tagGroupsRes.data ?? []) as { id: string; name: string }[]).map(
      (r) => ({ id: r.id, name: r.name }),
    );

    const tagAssignments: TagAssignments = {};
    for (const r of (assetTagsRes.data ?? []) as {
      asset_id: string;
      group_id: string;
      value: string;
    }[]) {
      const byGroup = (tagAssignments[r.asset_id] ??= {});
      (byGroup[r.group_id] ??= []).push(r.value);
    }

    const valuationPoints: ValuationPoint[] = (
      (valuationsRes.data ?? []) as { asset_id: string; valued_on: string; value: number | string }[]
    ).map((r) => ({ assetId: r.asset_id, date: r.valued_on, value: Number(r.value) }));

    const accounts: Account[] = ((accountsRes.data ?? []) as AccountRow[]).map(accountFromRow);

    const accountBalances: AccountBalance[] = (
      (accountBalancesRes.data ?? []) as {
        account_id: string;
        balance_on: string;
        balance: number | string;
      }[]
    ).map((r) => ({ accountId: r.account_id, date: r.balance_on, balance: Number(r.balance) }));

    const spendingCategories: SpendingCategory[] = (
      (spendingCategoriesRes.data ?? []) as SpendingCategoryRow[]
    ).map(spendingCategoryFromRow);

    const spendingTransactions: SpendingTransaction[] = (
      (spendingTransactionsRes.data ?? []) as SpendingTransactionRow[]
    ).map(spendingTransactionFromRow);

    const budgets: Budget[] = ((budgetsRes.data ?? []) as BudgetRow[]).map(budgetFromRow);

    const contracts: Contract[] = ((contractsRes.data ?? []) as ContractRow[]).map(
      contractFromRow,
    );

    const goals: Goal[] = ((goalsRes.data ?? []) as GoalRow[]).map(goalFromRow);

    const llmRow = llmSettingsRes.data as {
      provider: string;
      model: string;
      api_key: string;
    } | null;
    const llmConfig: LlmConfig | null = llmRow
      ? { provider: llmRow.provider as LlmProviderId, model: llmRow.model, key: llmRow.api_key }
      : null;

    return {
      profile,
      portfolios,
      assets,
      transactions,
      watchlist,
      savingsPlans,
      tagGroups,
      tagAssignments,
      valuationPoints,
      accounts,
      accountBalances,
      spendingCategories,
      spendingTransactions,
      budgets,
      contracts,
      goals,
      llmConfig,
    };
  }

  async saveProfile(profile: Profile): Promise<void> {
    const { error } = await this.supabase.from("profiles").upsert({
      id: this.userId,
      currency: profile.currency,
      display_name: profile.name,
      locale: profile.locale,
      theme: profile.theme,
      tax_allowance: profile.taxAllowance,
      church_tax_rate: profile.churchTaxRate,
      tax_teilfreistellung: profile.taxTeilfreistellung,
      tax_vorabpauschale: profile.taxVorabpauschale,
      tax_withheld_override: profile.taxWithheldOverride,
      tour_done_at: profile.tourDoneAt,
      tours_done: profile.toursDone,
      rebalance_targets: profile.rebalanceTargets,
    });
    if (error) throw error;
  }

  /**
   * Find the (global) instrument matching the input's identifiers, or create
   * one. Instruments are shared reference data — assets just link to them.
   */
  private async resolveInstrument(input: Omit<AssetInput, "notes">): Promise<string> {
    const ors: string[] = [];
    if (input.isin) ors.push(`isin.eq.${input.isin}`);
    if (input.wkn) ors.push(`wkn.eq.${input.wkn}`);
    if (input.symbol) ors.push(`symbol.eq.${input.symbol}`);

    if (ors.length > 0) {
      const existing = await this.selectInstrumentByIdentifier(ors);
      if (existing) return existing;
    }

    const { data, error } = await this.supabase
      .from("instruments")
      .insert({
        isin: input.isin,
        wkn: input.wkn,
        symbol: input.symbol,
        name: input.name,
        type: input.type,
        currency: input.currency,
      })
      .select("id")
      .single();
    if (error) {
      // Two concurrent imports of the same not-yet-cataloged security both
      // pass the SELECT above, then race the unique isin/wkn/symbol indexes
      // (migration 0032) — the loser gets a unique_violation here, not a
      // real failure. Re-select and hand back the winner's row instead of
      // throwing.
      if ((error as { code?: string }).code === "23505" && ors.length > 0) {
        const existing = await this.selectInstrumentByIdentifier(ors);
        if (existing) return existing;
      }
      throw error;
    }
    return (data as { id: string }).id;
  }

  private async selectInstrumentByIdentifier(ors: string[]): Promise<string | null> {
    const { data } = await this.supabase
      .from("instruments")
      .select("id")
      .or(ors.join(","))
      .limit(1);
    if (data && data.length > 0) return (data[0] as { id: string }).id;
    return null;
  }

  async addAsset(input: AssetInput, id?: string): Promise<Asset> {
    const instrumentId = await this.resolveInstrument(input);
    const { data, error } = await this.supabase
      .from("assets")
      .insert({
        // `id` omitted (undefined is dropped from the JSON body) lets the
        // column default (`gen_random_uuid()`) apply; passed explicitly by
        // `OfflineStore` on replay so the row matches its offline mirror id
        // (OFFLINE_DESIGN.md §3 — RLS checks user_id, not id).
        id,
        user_id: this.userId,
        instrument_id: instrumentId,
        currency: input.currency, // the user's per-holding trading currency
        notes: input.notes,
        interest_rate: input.interestRate ?? null,
        interest_frequency: input.interestFrequency ?? null,
        interest_post_day: input.interestPostDay ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ...input, id: (data as { id: string }).id };
  }

  async updateAsset(id: string, patch: Partial<AssetInput>): Promise<void> {
    // Only asset-level fields live here (notes + the CASH interest config);
    // master data lives on the shared instrument.
    const update: Record<string, unknown> = {};
    if (patch.notes !== undefined) update.notes = patch.notes;
    if (patch.interestRate !== undefined) update.interest_rate = patch.interestRate;
    if (patch.interestFrequency !== undefined) update.interest_frequency = patch.interestFrequency;
    if (patch.interestPostDay !== undefined) update.interest_post_day = patch.interestPostDay;
    if (Object.keys(update).length === 0) return;
    // No .eq("user_id", ...): RLS permits editing a household peer's asset
    // too (migration 0093).
    const { data, error } = await this.supabase
      .from("assets")
      .update(update)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    // Postgres doesn't error on an UPDATE that matches zero rows — `.select()`
    // the affected row(s) and throw distinctly so a phase-3 replay can tell
    // "already gone" (drop the op) apart from "actually failed" (retry/queue).
    if (!data || data.length === 0) throw new RowNotFoundError(`asset ${id} not found`);
  }

  async deleteAsset(id: string): Promise<void> {
    // Transactions cascade via the asset_id FK. No .eq("user_id", ...): RLS
    // permits deleting a household peer's asset too.
    const { error } = await this.supabase.from("assets").delete().eq("id", id);
    if (error) throw error;
  }

  async addTransaction(input: TransactionInput, id?: string): Promise<Transaction> {
    const { data, error } = await this.supabase
      .from("transactions")
      .insert({
        id, // see addAsset — undefined lets the DB default generate one
        asset_id: input.assetId,
        portfolio_id: input.portfolioId,
        type: input.type,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee,
        tax: input.tax,
        executed_at: input.date,
      })
      .select("id, asset_id, portfolio_id, type, quantity, price, fee, tax, executed_at")
      .single();
    if (error) throw error;
    const r = data as TxRow;
    return {
      id: r.id,
      assetId: r.asset_id,
      portfolioId: r.portfolio_id ?? input.portfolioId,
      type: r.type,
      quantity: Number(r.quantity),
      price: Number(r.price),
      fee: Number(r.fee),
      tax: Number(r.tax ?? 0),
      date: r.executed_at,
    };
  }

  async updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<void> {
    const upd: Record<string, unknown> = {};
    if (patch.assetId !== undefined) upd.asset_id = patch.assetId;
    if (patch.portfolioId !== undefined) upd.portfolio_id = patch.portfolioId;
    if (patch.type !== undefined) upd.type = patch.type;
    if (patch.quantity !== undefined) upd.quantity = patch.quantity;
    if (patch.price !== undefined) upd.price = patch.price;
    if (patch.fee !== undefined) upd.fee = patch.fee;
    if (patch.tax !== undefined) upd.tax = patch.tax;
    if (patch.date !== undefined) upd.executed_at = patch.date;
    if (Object.keys(upd).length === 0) return;
    const { data, error } = await this.supabase
      .from("transactions")
      .update(upd)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    // See updateAsset above: a zero-row match must be distinguishable from a
    // real failure for the phase-3 replay to apply the LWW drop rule.
    if (!data || data.length === 0) throw new RowNotFoundError(`transaction ${id} not found`);
  }

  async deleteTransaction(id: string): Promise<void> {
    // RLS restricts deletion to the user's own transactions.
    const { error } = await this.supabase
      .from("transactions")
      .delete()
      .eq("id", id);
    if (error) throw error;
  }

  async addWatchlistItem(input: WatchlistInput, id?: string): Promise<WatchlistItem> {
    // Watchlist items link to the shared instruments catalog, like assets.
    const instrumentId = await this.resolveInstrument(input);
    const { data, error } = await this.supabase
      .from("watchlist_items")
      .insert({
        id, // see addAsset — undefined lets the DB default generate one
        user_id: this.userId,
        instrument_id: instrumentId,
        currency: input.currency, // the user's per-item currency override
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ...input, id: (data as { id: string }).id };
  }

  async removeWatchlistItem(id: string): Promise<void> {
    // No .eq("user_id", ...): RLS permits removing a household peer's item too.
    const { error } = await this.supabase.from("watchlist_items").delete().eq("id", id);
    if (error) throw error;
  }

  async updateWatchlistItem(id: string, patch: Partial<WatchlistInput>): Promise<void> {
    // Only `currency` is item-level; master data lives on the instrument.
    // No .eq("user_id", ...): RLS permits editing a household peer's item too.
    if (patch.currency === undefined) return;
    const { data, error } = await this.supabase
      .from("watchlist_items")
      .update({ currency: patch.currency })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    // See updateAsset above: a zero-row match must be distinguishable from a
    // real failure for the phase-3 replay to apply the LWW drop rule.
    if (!data || data.length === 0) throw new RowNotFoundError(`watchlist item ${id} not found`);
  }

  async addSavingsPlan(input: SavingsPlanInput, id?: string): Promise<SavingsPlan> {
    const { data, error } = await this.supabase
      .from("savings_plans")
      .insert({
        id, // see addAsset — undefined lets the DB default generate one
        user_id: this.userId,
        asset_id: input.assetId,
        portfolio_id: input.portfolioId,
        amount: input.amount,
        frequency: input.interval,
        booking_type: input.bookingType ?? "BUY",
        start_date: input.startDate,
        active: input.active,
        last_run_date: input.lastRunDate,
      })
      .select("id, asset_id, portfolio_id, amount, frequency, booking_type, start_date, active, last_run_date")
      .single();
    if (error) throw error;
    return planFromRow(data as SavingsPlanRow);
  }

  async updateSavingsPlan(id: string, patch: Partial<SavingsPlanInput>): Promise<void> {
    const upd: Record<string, unknown> = {};
    if (patch.assetId !== undefined) upd.asset_id = patch.assetId;
    if (patch.portfolioId !== undefined) upd.portfolio_id = patch.portfolioId;
    if (patch.amount !== undefined) upd.amount = patch.amount;
    if (patch.interval !== undefined) upd.frequency = patch.interval;
    if (patch.bookingType !== undefined) upd.booking_type = patch.bookingType;
    if (patch.startDate !== undefined) upd.start_date = patch.startDate;
    if (patch.active !== undefined) upd.active = patch.active;
    if (patch.lastRunDate !== undefined) upd.last_run_date = patch.lastRunDate;
    if (Object.keys(upd).length === 0) return;
    // No .eq("user_id", ...): RLS permits editing a household peer's plan too.
    const { data, error } = await this.supabase
      .from("savings_plans")
      .update(upd)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    // See updateAsset — a zero-row match must be distinguishable for replay.
    if (!data || data.length === 0) throw new RowNotFoundError(`savings plan ${id} not found`);
  }

  async deleteSavingsPlan(id: string): Promise<void> {
    // No .eq("user_id", ...): RLS permits deleting a household peer's plan too.
    const { error } = await this.supabase.from("savings_plans").delete().eq("id", id);
    if (error) throw error;
  }

  async addTagGroup(name: string, id?: string): Promise<TagGroup> {
    const { data, error } = await this.supabase
      .from("tag_groups")
      .insert({
        id, // see addAsset — undefined lets the DB default generate one
        user_id: this.userId,
        name: name.trim() || "Tags",
      })
      .select("id, name")
      .single();
    if (error) throw error;
    const r = data as { id: string; name: string };
    return { id: r.id, name: r.name };
  }

  async renameTagGroup(id: string, name: string): Promise<void> {
    const n = name.trim();
    if (!n) return;
    // No .eq("user_id", ...): RLS permits renaming a household peer's group too.
    const { data, error } = await this.supabase
      .from("tag_groups")
      .update({ name: n })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    // See updateAsset above — a zero-row match must be distinguishable for replay.
    if (!data || data.length === 0) throw new RowNotFoundError(`tag group ${id} not found`);
  }

  async deleteTagGroup(id: string): Promise<void> {
    // asset_tags rows cascade via the group_id FK. No .eq("user_id", ...):
    // RLS permits deleting a household peer's group too.
    const { error } = await this.supabase.from("tag_groups").delete().eq("id", id);
    if (error) throw error;
  }

  async setAssetTags(assetId: string, groupId: string, values: string[]): Promise<void> {
    // Replace-set: clear the pair, then re-insert — idempotent, replay-safe
    // regardless of how many times it's applied. No .eq("user_id", ...) on
    // the delete: RLS permits clearing a household peer's asset's tags too
    // (the inserted rows below stay attributed to whoever is acting, same as
    // tag_groups/asset_tags carry no other ownership-sensitive display).
    const { error: delErr } = await this.supabase
      .from("asset_tags")
      .delete()
      .eq("asset_id", assetId)
      .eq("group_id", groupId);
    if (delErr) throw delErr;
    if (values.length === 0) return;
    const { error: insErr } = await this.supabase.from("asset_tags").insert(
      values.map((value) => ({
        user_id: this.userId,
        asset_id: assetId,
        group_id: groupId,
        value,
      })),
    );
    if (insErr) throw insErr;
  }

  async setAssetValuations(
    assetId: string,
    points: { date: string; value: number }[],
  ): Promise<void> {
    // Valuation rows are attributed to the ASSET's owner, not the acting
    // editor — same reasoning as setAccountBalances: a household peer
    // valuing someone else's OTHER asset must not reassign its history.
    const { data: asset, error: assetErr } = await this.supabase
      .from("assets")
      .select("user_id")
      .eq("id", assetId)
      .single();
    if (assetErr) throw assetErr;
    const ownerId = (asset as { user_id: string }).user_id;

    // Replace-set: clear the asset's points, then re-insert — idempotent and
    // replay-safe regardless of how many times it's applied (like setAssetTags).
    // No .eq("user_id", ...) on the delete: RLS permits clearing a household
    // peer's asset valuations too.
    const { error: delErr } = await this.supabase
      .from("asset_valuations")
      .delete()
      .eq("asset_id", assetId);
    if (delErr) throw delErr;
    if (points.length === 0) return;
    const { error: insErr } = await this.supabase.from("asset_valuations").insert(
      points.map((p) => ({
        user_id: ownerId,
        asset_id: assetId,
        valued_on: p.date,
        value: p.value,
      })),
    );
    if (insErr) throw insErr;
  }

  async addAccount(input: AccountInput, id?: string): Promise<Account> {
    const { data, error } = await this.supabase
      .from("accounts")
      .insert({
        id, // see addAsset — undefined lets the DB default generate one
        user_id: this.userId,
        name: input.name,
        kind: input.kind,
        currency: input.currency,
        is_liability: input.isLiability,
        opening_balance: input.openingBalance,
        opened_on: input.openedOn,
        interest_rate: input.interestRate ?? null,
        min_payment: input.minPayment ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ...input, id: (data as { id: string }).id };
  }

  async updateAccount(id: string, patch: Partial<AccountInput>): Promise<void> {
    const upd: Record<string, unknown> = {};
    if (patch.name !== undefined) upd.name = patch.name;
    if (patch.kind !== undefined) upd.kind = patch.kind;
    if (patch.currency !== undefined) upd.currency = patch.currency;
    if (patch.isLiability !== undefined) upd.is_liability = patch.isLiability;
    if (patch.openingBalance !== undefined) upd.opening_balance = patch.openingBalance;
    if (patch.openedOn !== undefined) upd.opened_on = patch.openedOn;
    if (patch.interestRate !== undefined) upd.interest_rate = patch.interestRate;
    if (patch.minPayment !== undefined) upd.min_payment = patch.minPayment;
    if (Object.keys(upd).length === 0) return;
    // No .eq("user_id", ...): RLS permits editing a household peer's account
    // (migration 0092) too, and the row's user_id is left unchanged either
    // way — only `id` scopes the match, matching RLS's own authorization.
    const { data, error } = await this.supabase
      .from("accounts")
      .update(upd)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    // See updateAsset — a zero-row match must be distinguishable for replay.
    if (!data || data.length === 0) throw new RowNotFoundError(`account ${id} not found`);
  }

  async deleteAccount(id: string): Promise<void> {
    // account_balances and spending_transactions cascade via the account_id FK.
    // No .eq("user_id", ...): RLS permits deleting a household peer's account too.
    const { error } = await this.supabase.from("accounts").delete().eq("id", id);
    if (error) throw error;
  }

  async setAccountBalances(
    accountId: string,
    points: { date: string; balance: number }[],
  ): Promise<void> {
    // Balance rows are attributed to the ACCOUNT's owner, not the acting
    // editor — a household peer editing someone else's account must not
    // reassign the balance history to themselves. Looked up via RLS (which
    // now permits reading a peer's account row, migration 0092).
    const { data: acct, error: acctErr } = await this.supabase
      .from("accounts")
      .select("user_id")
      .eq("id", accountId)
      .single();
    if (acctErr) throw acctErr;
    const ownerId = (acct as { user_id: string }).user_id;

    // Replace-set: clear the account's readings, then re-insert — idempotent
    // and replay-safe (like setAssetValuations). No .eq("user_id", ...):
    // RLS permits clearing a household peer's account balances too.
    const { error: delErr } = await this.supabase
      .from("account_balances")
      .delete()
      .eq("account_id", accountId);
    if (delErr) throw delErr;
    if (points.length === 0) return;
    const { error: insErr } = await this.supabase.from("account_balances").insert(
      points.map((p) => ({
        user_id: ownerId,
        account_id: accountId,
        balance_on: p.date,
        balance: p.balance,
      })),
    );
    if (insErr) throw insErr;
  }

  async addSpendingCategory(input: SpendingCategoryInput, id?: string): Promise<SpendingCategory> {
    const { data, error } = await this.supabase
      .from("spending_categories")
      .insert({
        id, // see addAsset — undefined lets the DB default generate one
        user_id: this.userId,
        group_name: input.groupName,
        name: input.name,
        tax_deductible: input.taxDeductible ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ...input, id: (data as { id: string }).id };
  }

  async updateSpendingCategory(id: string, patch: Partial<SpendingCategoryInput>): Promise<void> {
    const upd: Record<string, unknown> = {};
    if (patch.groupName !== undefined) upd.group_name = patch.groupName;
    if (patch.name !== undefined) upd.name = patch.name;
    if (patch.taxDeductible !== undefined) upd.tax_deductible = patch.taxDeductible;
    if (Object.keys(upd).length === 0) return;
    // No .eq("user_id", ...): RLS permits editing a household peer's category too.
    const { data, error } = await this.supabase
      .from("spending_categories")
      .update(upd)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new RowNotFoundError(`spending category ${id} not found`);
  }

  async deleteSpendingCategory(id: string): Promise<void> {
    // Referencing spending_transactions.category_id sets null via the FK.
    // No .eq("user_id", ...): RLS permits deleting a household peer's category too.
    const { error } = await this.supabase.from("spending_categories").delete().eq("id", id);
    if (error) throw error;
  }

  async addSpendingTransaction(
    input: SpendingTransactionInput,
    id?: string,
  ): Promise<SpendingTransaction> {
    const { data, error } = await this.supabase
      .from("spending_transactions")
      .insert({
        id, // see addAsset — undefined lets the DB default generate one
        user_id: this.userId,
        account_id: input.accountId,
        category_id: input.categoryId,
        date: input.date,
        amount: input.amount,
        payee: input.payee,
        note: input.note,
        recurring_id: input.recurringId,
        transfer_account_id: input.transferAccountId ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ...input, id: (data as { id: string }).id };
  }

  async updateSpendingTransaction(
    id: string,
    patch: Partial<SpendingTransactionInput>,
  ): Promise<void> {
    const upd: Record<string, unknown> = {};
    if (patch.accountId !== undefined) upd.account_id = patch.accountId;
    if (patch.categoryId !== undefined) upd.category_id = patch.categoryId;
    if (patch.date !== undefined) upd.date = patch.date;
    if (patch.amount !== undefined) upd.amount = patch.amount;
    if (patch.payee !== undefined) upd.payee = patch.payee;
    if (patch.note !== undefined) upd.note = patch.note;
    if (patch.recurringId !== undefined) upd.recurring_id = patch.recurringId;
    if (patch.transferAccountId !== undefined) upd.transfer_account_id = patch.transferAccountId;
    if (Object.keys(upd).length === 0) return;
    // No .eq("user_id", ...): RLS permits editing a household peer's transaction too.
    const { data, error } = await this.supabase
      .from("spending_transactions")
      .update(upd)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new RowNotFoundError(`spending transaction ${id} not found`);
    }
  }

  async deleteSpendingTransaction(id: string): Promise<void> {
    // No .eq("user_id", ...): RLS permits deleting a household peer's transaction too.
    const { error } = await this.supabase.from("spending_transactions").delete().eq("id", id);
    if (error) throw error;
  }

  async addBudget(input: BudgetInput, id?: string): Promise<Budget> {
    const { data, error } = await this.supabase
      .from("budgets")
      .insert({
        id, // see addAsset — undefined lets the DB default generate one
        user_id: this.userId,
        category_id: input.categoryId,
        amount: input.amount,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ...input, id: (data as { id: string }).id };
  }

  async updateBudget(id: string, patch: Partial<BudgetInput>): Promise<void> {
    const upd: Record<string, unknown> = {};
    if (patch.categoryId !== undefined) upd.category_id = patch.categoryId;
    if (patch.amount !== undefined) upd.amount = patch.amount;
    if (Object.keys(upd).length === 0) return;
    // No .eq("user_id", ...): RLS permits editing a household peer's budget too.
    const { data, error } = await this.supabase
      .from("budgets")
      .update(upd)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new RowNotFoundError(`budget ${id} not found`);
  }

  async deleteBudget(id: string): Promise<void> {
    // No .eq("user_id", ...): RLS permits deleting a household peer's budget too.
    const { error } = await this.supabase.from("budgets").delete().eq("id", id);
    if (error) throw error;
  }

  async addContract(input: ContractInput, id?: string): Promise<Contract> {
    const { data, error } = await this.supabase
      .from("contracts")
      .insert({
        id, // see addAsset — undefined lets the DB default generate one
        user_id: this.userId,
        name: input.name,
        amount: input.amount,
        interval: input.interval,
        renewal_date: input.renewalDate,
        cancellation_notice_days: input.cancellationNoticeDays,
        category_id: input.categoryId,
        insurance_type: input.insuranceType ?? null,
        sum_insured: input.sumInsured ?? null,
        account_id: input.accountId ?? null,
        booking_start_date: input.bookingStartDate ?? null,
        last_booked_date: input.lastBookedDate ?? null,
        target_account_id: input.targetAccountId ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ...input, id: (data as { id: string }).id };
  }

  async updateContract(id: string, patch: Partial<ContractInput>): Promise<void> {
    const upd: Record<string, unknown> = {};
    if (patch.name !== undefined) upd.name = patch.name;
    if (patch.amount !== undefined) upd.amount = patch.amount;
    if (patch.interval !== undefined) upd.interval = patch.interval;
    if (patch.renewalDate !== undefined) upd.renewal_date = patch.renewalDate;
    if (patch.cancellationNoticeDays !== undefined) {
      upd.cancellation_notice_days = patch.cancellationNoticeDays;
    }
    if (patch.categoryId !== undefined) upd.category_id = patch.categoryId;
    if (patch.insuranceType !== undefined) upd.insurance_type = patch.insuranceType;
    if (patch.sumInsured !== undefined) upd.sum_insured = patch.sumInsured;
    if (patch.accountId !== undefined) upd.account_id = patch.accountId;
    if (patch.bookingStartDate !== undefined) upd.booking_start_date = patch.bookingStartDate;
    if (patch.lastBookedDate !== undefined) upd.last_booked_date = patch.lastBookedDate;
    if (patch.targetAccountId !== undefined) upd.target_account_id = patch.targetAccountId;
    if (Object.keys(upd).length === 0) return;
    // No .eq("user_id", ...): RLS permits editing a household peer's contract too.
    const { data, error } = await this.supabase
      .from("contracts")
      .update(upd)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new RowNotFoundError(`contract ${id} not found`);
  }

  async deleteContract(id: string): Promise<void> {
    // No .eq("user_id", ...): RLS permits deleting a household peer's contract too.
    const { error } = await this.supabase.from("contracts").delete().eq("id", id);
    if (error) throw error;
  }

  async addGoal(input: GoalInput, id?: string): Promise<Goal> {
    const { data, error } = await this.supabase
      .from("goals")
      .insert({
        id, // see addAsset — undefined lets the DB default generate one
        user_id: this.userId,
        name: input.name,
        target_amount: input.targetAmount,
        target_date: input.targetDate,
        linked_account_id: input.linkedAccountId,
        manual_current_amount: input.manualCurrentAmount,
        tracks_investments: input.tracksInvestments,
        linked_portfolio_id: input.linkedPortfolioId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ...input, id: (data as { id: string }).id };
  }

  async updateGoal(id: string, patch: Partial<GoalInput>): Promise<void> {
    const upd: Record<string, unknown> = {};
    if (patch.name !== undefined) upd.name = patch.name;
    if (patch.targetAmount !== undefined) upd.target_amount = patch.targetAmount;
    if (patch.targetDate !== undefined) upd.target_date = patch.targetDate;
    if (patch.linkedAccountId !== undefined) upd.linked_account_id = patch.linkedAccountId;
    if (patch.tracksInvestments !== undefined) upd.tracks_investments = patch.tracksInvestments;
    if (patch.linkedPortfolioId !== undefined) {
      upd.linked_portfolio_id = patch.linkedPortfolioId;
    }
    if (patch.manualCurrentAmount !== undefined) {
      upd.manual_current_amount = patch.manualCurrentAmount;
    }
    if (Object.keys(upd).length === 0) return;
    // No .eq("user_id", ...): RLS permits editing a household peer's goal too.
    const { data, error } = await this.supabase
      .from("goals")
      .update(upd)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new RowNotFoundError(`goal ${id} not found`);
  }

  async deleteGoal(id: string): Promise<void> {
    // No .eq("user_id", ...): RLS permits deleting a household peer's goal too.
    const { error } = await this.supabase.from("goals").delete().eq("id", id);
    if (error) throw error;
  }

  /**
   * Replace-set the user's LLM config. `llm_settings.user_id` is the primary
   * key, so a save is a plain upsert; `null` deletes the row. Idempotent /
   * replay-safe either way, same as `setAssetTags`.
   */
  async saveLlmConfig(config: LlmConfig | null): Promise<void> {
    if (config === null) {
      const { error } = await this.supabase
        .from("llm_settings")
        .delete()
        .eq("user_id", this.userId);
      if (error) throw error;
      return;
    }
    const { error } = await this.supabase.from("llm_settings").upsert({
      user_id: this.userId,
      provider: config.provider,
      model: config.model,
      api_key: config.key,
    });
    if (error) throw error;
  }

  async createPortfolio(name: string, id?: string): Promise<Portfolio> {
    const { count } = await this.supabase
      .from("portfolios")
      .select("id", { count: "exact", head: true })
      .eq("user_id", this.userId);
    if ((count ?? 0) >= MAX_PORTFOLIOS) {
      throw new Error(`You can have at most ${MAX_PORTFOLIOS} portfolios.`);
    }
    const { data, error } = await this.supabase
      .from("portfolios")
      .insert({ id, user_id: this.userId, name: name.trim() || "Portfolio" })
      .select("id, name, fee_order_flat, fee_order_free_from, fee_savings_plan, tax_allowance")
      .single();
    if (error) throw error;
    return portfolioFromRow(data as PortfolioRow);
  }

  async renamePortfolio(id: string, name: string): Promise<void> {
    return this.updatePortfolio(id, { name });
  }

  async updatePortfolio(id: string, patch: PortfolioPatch): Promise<void> {
    const upd: Record<string, unknown> = {};
    // A blank name is treated as "keep the current name" (mirrors renamePortfolio's
    // prior `name.trim() || ...` behaviour) rather than writing an empty string.
    if (patch.name !== undefined && patch.name.trim()) upd.name = patch.name.trim();
    if (patch.feeOrderFlat !== undefined) upd.fee_order_flat = patch.feeOrderFlat;
    if (patch.feeOrderFreeFrom !== undefined) upd.fee_order_free_from = patch.feeOrderFreeFrom;
    if (patch.feeSavingsPlan !== undefined) upd.fee_savings_plan = patch.feeSavingsPlan;
    if (patch.taxAllowance !== undefined) upd.tax_allowance = patch.taxAllowance;
    if (Object.keys(upd).length === 0) return;
    // No .eq("user_id", ...): RLS permits editing a household peer's portfolio too.
    const { error } = await this.supabase.from("portfolios").update(upd).eq("id", id);
    if (error) throw error;
  }

  async deletePortfolio(id: string): Promise<void> {
    // imported_rows cleanup for these transactions rides on the
    // transaction_id FK's on-delete-cascade — nothing extra needed here.
    // "Keep at least one portfolio" is a per-account safety rail, deliberately
    // scoped to the acting user's own portfolios (unaffected by household
    // sharing) — a household member always keeps at least one of their own.
    const { count } = await this.supabase
      .from("portfolios")
      .select("id", { count: "exact", head: true })
      .eq("user_id", this.userId);
    if ((count ?? 0) <= 1) return;
    // Cascade: delete the portfolio's transactions, then any asset that was
    // held only through them (no transactions left in other portfolios).
    const { data: doomedRows, error: doomedErr } = await this.supabase
      .from("transactions")
      .select("asset_id")
      .eq("portfolio_id", id);
    if (doomedErr) throw doomedErr;
    const doomed = [...new Set((doomedRows ?? []).map((r) => r.asset_id as string))];

    const { error: txErr } = await this.supabase
      .from("transactions")
      .delete()
      .eq("portfolio_id", id);
    if (txErr) throw txErr;

    if (doomed.length > 0) {
      const { data: stillUsedRows, error: usedErr } = await this.supabase
        .from("transactions")
        .select("asset_id")
        .in("asset_id", doomed);
      if (usedErr) throw usedErr;
      const stillUsed = new Set((stillUsedRows ?? []).map((r) => r.asset_id as string));
      const orphans = doomed.filter((a) => !stillUsed.has(a));
      if (orphans.length > 0) {
        // No .eq("user_id", ...): a shared portfolio's orphaned assets may
        // belong to a household peer, not the acting user; RLS still scopes
        // this to household-visible assets.
        const { error: assetErr } = await this.supabase.from("assets").delete().in("id", orphans);
        if (assetErr) throw assetErr;
      }
    }

    // No .eq("user_id", ...): RLS permits deleting a household peer's portfolio too.
    const { error } = await this.supabase.from("portfolios").delete().eq("id", id);
    if (error) throw error;
  }

  async loadSimulation(hash: string): Promise<SimulationCacheEntry | null> {
    const { data } = await this.supabase
      .from("simulation_runs")
      .select("params, seed, result, created_at")
      .eq("user_id", this.userId)
      .eq("params_hash", hash)
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as { params: unknown; seed: number; result: unknown; created_at: string };
    return { hash, params: row.params, seed: Number(row.seed), result: row.result, createdAt: row.created_at };
  }

  async saveSimulation(entry: SimulationCacheEntry): Promise<void> {
    await this.supabase.from("simulation_runs").upsert(
      {
        user_id: this.userId,
        params_hash: entry.hash,
        params: entry.params,
        seed: entry.seed,
        result: entry.result,
      },
      { onConflict: "user_id,params_hash" },
    );
  }

  async loadImportedFingerprints(): Promise<string[]> {
    // No .eq("user_id", ...): a household peer's already-imported rows count
    // too, so re-importing the same statement into a shared portfolio stays
    // a no-op regardless of which member imports it (migration 0093).
    const { data } = await this.supabase.from("imported_rows").select("fingerprint");
    return ((data ?? []) as { fingerprint: string }[]).map((r) => r.fingerprint);
  }

  async addImportedFingerprints(
    entries: { fingerprint: string; transactionId: string | null }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.supabase.from("imported_rows").upsert(
      entries.map((e) => ({
        user_id: this.userId,
        fingerprint: e.fingerprint,
        transaction_id: e.transactionId,
      })),
      { onConflict: "user_id,fingerprint" },
    );
  }

  async loadImportedSpendingFingerprints(): Promise<string[]> {
    // No .eq("user_id", ...): same reasoning as loadImportedFingerprints above.
    const { data } = await this.supabase.from("imported_spending_rows").select("fingerprint");
    return ((data ?? []) as { fingerprint: string }[]).map((r) => r.fingerprint);
  }

  async addImportedSpendingFingerprints(
    entries: { fingerprint: string; spendingTransactionId: string | null }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.supabase.from("imported_spending_rows").upsert(
      entries.map((e) => ({
        user_id: this.userId,
        fingerprint: e.fingerprint,
        spending_transaction_id: e.spendingTransactionId,
      })),
      { onConflict: "user_id,fingerprint" },
    );
  }
}
