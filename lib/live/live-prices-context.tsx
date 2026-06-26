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
    const live: Record<string, number> = {};
    for (const asset of data.assets) {
      const inst = lookupInstrument(assetPriceKey(asset));
      if (inst?.lastPrice != null) live[assetPriceKey(asset)] = inst.lastPrice;
    }
    return { base, live, fx: fxToBase(base) };
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
