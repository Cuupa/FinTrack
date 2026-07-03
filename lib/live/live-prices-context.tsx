"use client";

// Valuation context (prices + FX). Ongoing prices come from the catalog cache,
// populated server-side by the price-sync cron (/api/cron/sync-prices) — the
// client does NOT poll. The one exception: a freshly added asset the cron
// hasn't cached yet is priced with a single on-demand fetch (/api/price, in the
// holding's own currency) so it shows a real value immediately instead of the
// synthetic fallback. That fetch happens once per uncached holding, not on a
// timer.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePortfolio } from "../portfolio/portfolio-context";
import { useCatalog } from "../catalog/catalog-context";
import { fxToBase, lookupInstrument } from "../catalog/catalog";
import { assetPriceKey } from "../types";
import type { ValuationContext } from "../finance/portfolio";

interface LivePricesValue {
  valuation: ValuationContext;
}

const LivePricesContext = createContext<LivePricesValue | null>(null);

export function LivePricesProvider({ children }: { children: ReactNode }) {
  const { data } = usePortfolio();
  const { version } = useCatalog();
  const base = data.profile.currency;

  // On-demand prices for holdings the cron hasn't cached yet, keyed by price key
  // and already in the holding's own currency.
  const [fetched, setFetched] = useState<Record<string, number>>({});

  // Holdings with no cached price that we can resolve on demand (equities).
  const uncached = useMemo(() => {
    const out: { key: string; q: string; currency: string; name: string }[] = [];
    for (const asset of data.assets) {
      if (asset.type !== "STOCK" && asset.type !== "ETF") continue;
      const key = assetPriceKey(asset);
      if (lookupInstrument(key)?.lastPrice != null) continue; // cron has it
      if (fetched[key] != null) continue; // already fetched this session
      const q = asset.isin || asset.symbol;
      if (q) out.push({ key, q, currency: asset.currency ?? base, name: asset.name });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.assets, base, version, fetched]);

  const sig = useMemo(() => uncached.map((u) => `${u.key}:${u.currency}`).join(","), [uncached]);

  useEffect(() => {
    if (uncached.length === 0) return;
    let cancelled = false;
    const run = async () => {
      const results = await Promise.all(
        uncached.map(async (u) => {
          try {
            // `name` is a fallback Yahoo search query for when `q` (the
            // ISIN/WKN/symbol) turns up no search results at all — some real
            // ISINs aren't in Yahoo's search index (e.g. Alphabet's Class C
            // ISIN US02079K3059 resolves by name but not by ISIN or WKN).
            const res = await fetch(
              `/api/price?q=${encodeURIComponent(u.q)}&currency=${encodeURIComponent(u.currency)}&name=${encodeURIComponent(u.name)}`,
            );
            if (!res.ok) return null;
            const d = (await res.json()) as { found?: boolean; price?: number };
            if (d.found && typeof d.price === "number" && d.price > 0) {
              return [u.key, d.price] as const;
            }
          } catch {
            /* ignore — falls back to the synthetic price */
          }
          return null;
        }),
      );
      if (cancelled) return;
      const add: Record<string, number> = {};
      for (const r of results) if (r) add[r[0]] = r[1];
      if (Object.keys(add).length > 0) setFetched((prev) => ({ ...prev, ...add }));
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const valuation = useMemo<ValuationContext>(() => {
    const fx = fxToBase(base);
    const toBase = (cur: string) => (!cur || cur === base ? 1 : (fx[cur] ?? 1));
    const live: Record<string, number> = {};
    for (const asset of data.assets) {
      const key = assetPriceKey(asset);
      const inst = lookupInstrument(key);
      if (inst?.lastPrice != null) {
        // Convert the instrument's cached price (its currency) into THIS
        // holding's currency; the shared instrument is left untouched.
        const from = inst.currency ?? base;
        const to = asset.currency ?? from;
        live[key] = from === to ? inst.lastPrice : (inst.lastPrice * toBase(from)) / toBase(to);
      } else if (fetched[key] != null) {
        // On-demand price (already in the holding's currency).
        live[key] = fetched[key];
      }
    }
    return { base, live, fx };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.assets, base, version, fetched]);

  return (
    <LivePricesContext.Provider value={{ valuation }}>{children}</LivePricesContext.Provider>
  );
}

export function useLivePrices(): LivePricesValue {
  const ctx = useContext(LivePricesContext);
  if (!ctx) throw new Error("useLivePrices must be used within LivePricesProvider");
  return ctx;
}
