// Serves the instruments catalog to the client. Reads the public `instruments`
// table from Supabase server-side (anon key is enough — the table is
// world-readable). Returns an empty catalog when Supabase isn't configured, so
// the app still runs (auto-import is simply unavailable, synthetic pricing
// covers the rest).

import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

interface InstrumentRow {
  isin: string | null;
  wkn: string | null;
  symbol: string | null;
  name: string;
  type: string;
  currency: string | null;
  country: string | null;
  sector: string | null;
  region: string | null;
  quote_source: string | null;
  quote_id: string | null;
  base_price: number | string;
  drift: number | string;
  vol: number | string;
  dividend_yield: number | string;
  last_price: number | string | null;
  price_synced_at: string | null;
}

interface ConstituentRow {
  etf_symbol: string;
  constituent_name: string;
  constituent_symbol: string | null;
  constituent_isin: string | null;
  weight: number | string;
  sector: string | null;
  region: string | null;
}

export async function GET(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return Response.json({ instruments: [], constituents: [], fxRates: {} });
  }

  try {
    const supabase = createClient(url, key);
    const [instRes, consRes, fxRes] = await Promise.all([
      supabase
        .from("instruments")
        .select(
          "isin, wkn, symbol, name, type, currency, country, sector, region, quote_source, quote_id, base_price, drift, vol, dividend_yield, last_price, price_synced_at",
        ),
      supabase
        .from("instrument_constituents")
        .select(
          "etf_symbol, constituent_name, constituent_symbol, constituent_isin, weight, sector, region",
        ),
      supabase.from("fx_rates").select("currency, rate"),
    ]);
    if (instRes.error) throw instRes.error;

    const instruments = (instRes.data ?? []).map((r: InstrumentRow) => ({
      isin: r.isin,
      wkn: r.wkn,
      symbol: r.symbol,
      name: r.name,
      type: r.type,
      currency: r.currency,
      country: r.country,
      sector: r.sector,
      region: r.region,
      quoteSource: r.quote_source,
      quoteId: r.quote_id,
      basePrice: Number(r.base_price),
      drift: Number(r.drift),
      vol: Number(r.vol),
      dividendYield: Number(r.dividend_yield),
      lastPrice: r.last_price != null ? Number(r.last_price) : null,
      priceSyncedAt: r.price_synced_at,
    }));

    const constituents = (consRes.data ?? []).map((r: ConstituentRow) => ({
      etfSymbol: r.etf_symbol,
      name: r.constituent_name,
      symbol: r.constituent_symbol,
      isin: r.constituent_isin,
      weight: Number(r.weight),
      sector: r.sector,
      region: r.region,
    }));

    const fxRates: Record<string, number> = {};
    for (const r of (fxRes.data ?? []) as { currency: string; rate: number | string }[]) {
      fxRates[r.currency.toUpperCase()] = Number(r.rate);
    }

    return Response.json({ instruments, constituents, fxRates });
  } catch {
    return Response.json({ instruments: [], constituents: [], fxRates: {} });
  }
}
