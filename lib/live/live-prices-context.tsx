"use client";

// Valuation context (prices + FX), derived entirely from the catalog cache —
// which is populated server-side by the price-sync cron (/api/cron/sync-prices)
// and delivered in one /api/catalog call. The client makes NO external price or
// FX calls; refreshing is the cron's job. Anything the cron hasn't cached
// (custom assets, or when no cron has run) falls back to the synthetic price /
// seeded FX rates.

import { createContext, useContext, useMemo, type ReactNode } from "react";
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

  const valuation = useMemo<ValuationContext>(() => {
    const fx = fxToBase(base);
    const toBase = (cur: string) => (!cur || cur === base ? 1 : (fx[cur] ?? 1));
    const live: Record<string, number> = {};
    for (const asset of data.assets) {
      const key = assetPriceKey(asset);
      const inst = lookupInstrument(key);
      if (inst?.lastPrice == null) continue;
      // The instrument's cached price is in the instrument's currency; convert
      // it into THIS holding's currency so a EUR holding of a USD stock is
      // valued from the EUR price (the shared instrument is left untouched).
      const from = inst.currency ?? base;
      const to = asset.currency ?? from;
      live[key] = from === to ? inst.lastPrice : (inst.lastPrice * toBase(from)) / toBase(to);
    }
    return { base, live, fx };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.assets, base, version]);

  return (
    <LivePricesContext.Provider value={{ valuation }}>
      {children}
    </LivePricesContext.Provider>
  );
}

export function useLivePrices(): LivePricesValue {
  const ctx = useContext(LivePricesContext);
  if (!ctx) throw new Error("useLivePrices must be used within LivePricesProvider");
  return ctx;
}
