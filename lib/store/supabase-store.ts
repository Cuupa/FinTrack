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
  type Asset,
  type PortfolioData,
  type Profile,
  type Transaction,
} from "../types";
import type { AssetInput, DataStore, TransactionInput } from "./types";

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
    const [profileRes, assetsRes, txRes] = await Promise.all([
      this.supabase
        .from("profiles")
        .select("currency, display_name, locale")
        .eq("id", this.userId)
        .maybeSingle(),
      this.supabase
        .from("assets")
        .select(
          "id, notes, currency, instrument:instruments (isin, wkn, symbol, name, type, currency)",
        )
        .eq("user_id", this.userId),
      // RLS scopes transactions to the user's assets — no user_id column.
      this.supabase
        .from("transactions")
        .select("id, asset_id, type, quantity, price, fee, executed_at"),
    ]);

    if (assetsRes.error) throw assetsRes.error;
    if (txRes.error) throw txRes.error;

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
      type: r.type,
      quantity: Number(r.quantity),
      price: Number(r.price),
      fee: Number(r.fee),
      date: r.executed_at,
    }));

    return { profile, assets, transactions };
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
        type: input.type,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee,
        executed_at: input.date,
      })
      .select("id, asset_id, type, quantity, price, fee, executed_at")
      .single();
    if (error) throw error;
    const r = data as TxRow;
    return {
      id: r.id,
      assetId: r.asset_id,
      type: r.type,
      quantity: Number(r.quantity),
      price: Number(r.price),
      fee: Number(r.fee),
      date: r.executed_at,
    };
  }

  async deleteTransaction(id: string): Promise<void> {
    // RLS restricts deletion to the user's own transactions.
    const { error } = await this.supabase
      .from("transactions")
      .delete()
      .eq("id", id);
    if (error) throw error;
  }
}
