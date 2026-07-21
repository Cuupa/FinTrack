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
  type LlmConfig,
  type Portfolio,
  type PortfolioData,
  type Profile,
  type RebalancePlan,
  type SavingsPlan,
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
  DataStore,
  PortfolioPatch,
  SavingsPlanInput,
  SimulationCacheEntry,
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
      llmSettingsRes,
    ] = await Promise.all([
      this.supabase
        .from("profiles")
        .select(
          "currency, display_name, locale, theme, tax_allowance, church_tax_rate, tax_teilfreistellung, tax_vorabpauschale, tax_withheld_override, tour_done_at, tours_done, rebalance_targets",
        )
        .eq("id", this.userId)
        .maybeSingle(),
      this.supabase
        .from("portfolios")
        .select("id, name, fee_order_flat, fee_order_free_from, fee_savings_plan, tax_allowance")
        .eq("user_id", this.userId)
        .order("created_at", { ascending: true }),
      this.supabase
        .from("assets")
        .select(
          "id, notes, currency, interest_rate, interest_frequency, instrument:instruments (isin, wkn, symbol, name, type, currency)",
        )
        .eq("user_id", this.userId),
      // RLS scopes transactions to the user's assets — no user_id column.
      this.supabase
        .from("transactions")
        .select("id, asset_id, portfolio_id, type, quantity, price, fee, tax, executed_at"),
      this.supabase
        .from("watchlist_items")
        .select("id, currency, instrument:instruments (isin, wkn, symbol, name, type, currency)")
        .eq("user_id", this.userId)
        .order("created_at", { ascending: true }),
      this.supabase
        .from("savings_plans")
        .select("id, asset_id, portfolio_id, amount, frequency, booking_type, start_date, active, last_run_date")
        .eq("user_id", this.userId)
        .order("created_at", { ascending: true }),
      this.supabase
        .from("tag_groups")
        .select("id, name")
        .eq("user_id", this.userId)
        .order("created_at", { ascending: true }),
      this.supabase
        .from("asset_tags")
        .select("asset_id, group_id, value")
        .eq("user_id", this.userId),
      this.supabase
        .from("asset_valuations")
        .select("asset_id, valued_on, value")
        .eq("user_id", this.userId)
        .order("valued_on", { ascending: true }),
      this.supabase
        .from("accounts")
        .select("id, name, kind, currency, is_liability, opening_balance, opened_on")
        .eq("user_id", this.userId)
        .order("created_at", { ascending: true }),
      this.supabase
        .from("account_balances")
        .select("account_id, balance_on, balance")
        .eq("user_id", this.userId)
        .order("balance_on", { ascending: true }),
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
    if (Object.keys(update).length === 0) return;
    const { data, error } = await this.supabase
      .from("assets")
      .update(update)
      .eq("id", id)
      .eq("user_id", this.userId)
      .select("id");
    if (error) throw error;
    // Postgres doesn't error on an UPDATE that matches zero rows — `.select()`
    // the affected row(s) and throw distinctly so a phase-3 replay can tell
    // "already gone" (drop the op) apart from "actually failed" (retry/queue).
    if (!data || data.length === 0) throw new RowNotFoundError(`asset ${id} not found`);
  }

  async deleteAsset(id: string): Promise<void> {
    // Transactions cascade via the asset_id FK.
    const { error } = await this.supabase
      .from("assets")
      .delete()
      .eq("id", id)
      .eq("user_id", this.userId);
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
    const { error } = await this.supabase
      .from("watchlist_items")
      .delete()
      .eq("id", id)
      .eq("user_id", this.userId);
    if (error) throw error;
  }

  async updateWatchlistItem(id: string, patch: Partial<WatchlistInput>): Promise<void> {
    // Only `currency` is item-level; master data lives on the instrument.
    if (patch.currency === undefined) return;
    const { data, error } = await this.supabase
      .from("watchlist_items")
      .update({ currency: patch.currency })
      .eq("id", id)
      .eq("user_id", this.userId)
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
    const { data, error } = await this.supabase
      .from("savings_plans")
      .update(upd)
      .eq("id", id)
      .eq("user_id", this.userId)
      .select("id");
    if (error) throw error;
    // See updateAsset — a zero-row match must be distinguishable for replay.
    if (!data || data.length === 0) throw new RowNotFoundError(`savings plan ${id} not found`);
  }

  async deleteSavingsPlan(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("savings_plans")
      .delete()
      .eq("id", id)
      .eq("user_id", this.userId);
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
    const { data, error } = await this.supabase
      .from("tag_groups")
      .update({ name: n })
      .eq("id", id)
      .eq("user_id", this.userId)
      .select("id");
    if (error) throw error;
    // See updateAsset above — a zero-row match must be distinguishable for replay.
    if (!data || data.length === 0) throw new RowNotFoundError(`tag group ${id} not found`);
  }

  async deleteTagGroup(id: string): Promise<void> {
    // asset_tags rows cascade via the group_id FK.
    const { error } = await this.supabase
      .from("tag_groups")
      .delete()
      .eq("id", id)
      .eq("user_id", this.userId);
    if (error) throw error;
  }

  async setAssetTags(assetId: string, groupId: string, values: string[]): Promise<void> {
    // Replace-set: clear the pair, then re-insert — idempotent, replay-safe
    // regardless of how many times it's applied.
    const { error: delErr } = await this.supabase
      .from("asset_tags")
      .delete()
      .eq("asset_id", assetId)
      .eq("group_id", groupId)
      .eq("user_id", this.userId);
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
    // Replace-set: clear the asset's points, then re-insert — idempotent and
    // replay-safe regardless of how many times it's applied (like setAssetTags).
    const { error: delErr } = await this.supabase
      .from("asset_valuations")
      .delete()
      .eq("asset_id", assetId)
      .eq("user_id", this.userId);
    if (delErr) throw delErr;
    if (points.length === 0) return;
    const { error: insErr } = await this.supabase.from("asset_valuations").insert(
      points.map((p) => ({
        user_id: this.userId,
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
    if (Object.keys(upd).length === 0) return;
    const { data, error } = await this.supabase
      .from("accounts")
      .update(upd)
      .eq("id", id)
      .eq("user_id", this.userId)
      .select("id");
    if (error) throw error;
    // See updateAsset — a zero-row match must be distinguishable for replay.
    if (!data || data.length === 0) throw new RowNotFoundError(`account ${id} not found`);
  }

  async deleteAccount(id: string): Promise<void> {
    // account_balances cascade via the account_id FK.
    const { error } = await this.supabase
      .from("accounts")
      .delete()
      .eq("id", id)
      .eq("user_id", this.userId);
    if (error) throw error;
  }

  async setAccountBalances(
    accountId: string,
    points: { date: string; balance: number }[],
  ): Promise<void> {
    // Replace-set: clear the account's readings, then re-insert — idempotent
    // and replay-safe (like setAssetValuations).
    const { error: delErr } = await this.supabase
      .from("account_balances")
      .delete()
      .eq("account_id", accountId)
      .eq("user_id", this.userId);
    if (delErr) throw delErr;
    if (points.length === 0) return;
    const { error: insErr } = await this.supabase.from("account_balances").insert(
      points.map((p) => ({
        user_id: this.userId,
        account_id: accountId,
        balance_on: p.date,
        balance: p.balance,
      })),
    );
    if (insErr) throw insErr;
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
    const { error } = await this.supabase
      .from("portfolios")
      .update(upd)
      .eq("id", id)
      .eq("user_id", this.userId);
    if (error) throw error;
  }

  async deletePortfolio(id: string): Promise<void> {
    // imported_rows cleanup for these transactions rides on the
    // transaction_id FK's on-delete-cascade — nothing extra needed here.
    // Keep at least one portfolio.
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
        const { error: assetErr } = await this.supabase
          .from("assets")
          .delete()
          .in("id", orphans)
          .eq("user_id", this.userId);
        if (assetErr) throw assetErr;
      }
    }

    const { error } = await this.supabase
      .from("portfolios")
      .delete()
      .eq("id", id)
      .eq("user_id", this.userId);
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
    const { data } = await this.supabase
      .from("imported_rows")
      .select("fingerprint")
      .eq("user_id", this.userId);
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
}
