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
  MAX_PORTFOLIOS,
  type Asset,
  type Portfolio,
  type PortfolioData,
  type Profile,
  type SavingsPlan,
  type Transaction,
  type WatchlistItem,
} from "../types";
import { RowNotFoundError } from "./types";
import type {
  AssetInput,
  DataStore,
  SavingsPlanInput,
  SimulationCacheEntry,
  TransactionInput,
  WatchlistInput,
} from "./types";

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
    startDate: r.start_date,
    active: r.active,
    lastRunDate: r.last_run_date,
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
    const [profileRes, portfoliosRes, assetsRes, txRes, watchRes, plansRes] = await Promise.all([
      this.supabase
        .from("profiles")
        .select("currency, display_name, locale")
        .eq("id", this.userId)
        .maybeSingle(),
      this.supabase
        .from("portfolios")
        .select("id, name")
        .eq("user_id", this.userId)
        .order("created_at", { ascending: true }),
      this.supabase
        .from("assets")
        .select(
          "id, notes, currency, instrument:instruments (isin, wkn, symbol, name, type, currency)",
        )
        .eq("user_id", this.userId),
      // RLS scopes transactions to the user's assets — no user_id column.
      this.supabase
        .from("transactions")
        .select("id, asset_id, portfolio_id, type, quantity, price, fee, tax, executed_at"),
      this.supabase
        .from("watchlist_items")
        .select("id, instrument:instruments (isin, wkn, symbol, name, type, currency)")
        .eq("user_id", this.userId)
        .order("created_at", { ascending: true }),
      this.supabase
        .from("savings_plans")
        .select("id, asset_id, portfolio_id, amount, frequency, start_date, active, last_run_date")
        .eq("user_id", this.userId)
        .order("created_at", { ascending: true }),
    ]);

    if (assetsRes.error) throw assetsRes.error;
    if (txRes.error) throw txRes.error;
    if (watchRes.error) throw watchRes.error;
    if (plansRes.error) throw plansRes.error;

    // Ensure the user has at least one portfolio (creating a default for
    // pre-multi-portfolio accounts) and backfill orphaned transactions.
    let portfolios: Portfolio[] = ((portfoliosRes.data ?? []) as Portfolio[]).map((p) => ({
      id: p.id,
      name: p.name,
    }));
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
      (watchRes.data ?? []) as Pick<AssetRow, "id" | "instrument">[]
    ).map((r) => {
      const inst = embed(r as AssetRow);
      return {
        id: r.id,
        isin: inst?.isin ?? null,
        wkn: inst?.wkn ?? null,
        symbol: inst?.symbol ?? null,
        name: inst?.name ?? "",
        type: inst?.type ?? "STOCK",
        currency: inst?.currency ?? null,
      };
    });

    const savingsPlans: SavingsPlan[] = ((plansRes.data ?? []) as SavingsPlanRow[]).map(
      planFromRow,
    );

    return { profile, portfolios, assets, transactions, watchlist, savingsPlans };
  }

  async saveProfile(profile: Profile): Promise<void> {
    const { error } = await this.supabase.from("profiles").upsert({
      id: this.userId,
      currency: profile.currency,
      display_name: profile.name,
      locale: profile.locale,
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
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ...input, id: (data as { id: string }).id };
  }

  async updateAsset(id: string, patch: Partial<AssetInput>): Promise<void> {
    // Only `notes` is asset-level; master data lives on the instrument.
    if (patch.notes === undefined) return;
    const { data, error } = await this.supabase
      .from("assets")
      .update({ notes: patch.notes })
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
        start_date: input.startDate,
        active: input.active,
        last_run_date: input.lastRunDate,
      })
      .select("id, asset_id, portfolio_id, amount, frequency, start_date, active, last_run_date")
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
      .select("id, name")
      .single();
    if (error) throw error;
    return data as Portfolio;
  }

  async renamePortfolio(id: string, name: string): Promise<void> {
    const { error } = await this.supabase
      .from("portfolios")
      .update({ name: name.trim() })
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
