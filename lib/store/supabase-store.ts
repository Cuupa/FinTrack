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
  type Transaction,
} from "../types";
import type { AssetInput, DataStore, SimulationCacheEntry, TransactionInput } from "./types";

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
  executed_at: string;
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
    const [profileRes, portfoliosRes, assetsRes, txRes] = await Promise.all([
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
        .select("id, asset_id, portfolio_id, type, quantity, price, fee, executed_at"),
    ]);

    if (assetsRes.error) throw assetsRes.error;
    if (txRes.error) throw txRes.error;

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
      date: r.executed_at,
    }));

    return { profile, portfolios, assets, transactions };
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
  private async resolveInstrument(input: AssetInput): Promise<string> {
    const ors: string[] = [];
    if (input.isin) ors.push(`isin.eq.${input.isin}`);
    if (input.wkn) ors.push(`wkn.eq.${input.wkn}`);
    if (input.symbol) ors.push(`symbol.eq.${input.symbol}`);

    if (ors.length > 0) {
      const { data } = await this.supabase
        .from("instruments")
        .select("id")
        .or(ors.join(","))
        .limit(1);
      if (data && data.length > 0) return (data[0] as { id: string }).id;
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
    if (error) throw error;
    return (data as { id: string }).id;
  }

  async addAsset(input: AssetInput): Promise<Asset> {
    const instrumentId = await this.resolveInstrument(input);
    const { data, error } = await this.supabase
      .from("assets")
      .insert({
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
    const { error } = await this.supabase
      .from("assets")
      .update({ notes: patch.notes })
      .eq("id", id)
      .eq("user_id", this.userId);
    if (error) throw error;
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

  async addTransaction(input: TransactionInput): Promise<Transaction> {
    const { data, error } = await this.supabase
      .from("transactions")
      .insert({
        asset_id: input.assetId,
        portfolio_id: input.portfolioId,
        type: input.type,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee,
        executed_at: input.date,
      })
      .select("id, asset_id, portfolio_id, type, quantity, price, fee, executed_at")
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
    if (patch.date !== undefined) upd.executed_at = patch.date;
    if (Object.keys(upd).length === 0) return;
    const { error } = await this.supabase.from("transactions").update(upd).eq("id", id);
    if (error) throw error;
  }

  async deleteTransaction(id: string): Promise<void> {
    // RLS restricts deletion to the user's own transactions.
    const { error } = await this.supabase
      .from("transactions")
      .delete()
      .eq("id", id);
    if (error) throw error;
  }

  async createPortfolio(name: string): Promise<Portfolio> {
    const { count } = await this.supabase
      .from("portfolios")
      .select("id", { count: "exact", head: true })
      .eq("user_id", this.userId);
    if ((count ?? 0) >= MAX_PORTFOLIOS) {
      throw new Error(`You can have at most ${MAX_PORTFOLIOS} portfolios.`);
    }
    const { data, error } = await this.supabase
      .from("portfolios")
      .insert({ user_id: this.userId, name: name.trim() || "Portfolio" })
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

  async addImportedFingerprints(fingerprints: string[]): Promise<void> {
    if (fingerprints.length === 0) return;
    await this.supabase.from("imported_rows").upsert(
      fingerprints.map((f) => ({ user_id: this.userId, fingerprint: f })),
      { onConflict: "user_id,fingerprint" },
    );
  }
}
