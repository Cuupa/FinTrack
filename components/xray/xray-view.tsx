"use client";

// Portfolio X-ray: look-through exposure to individual stocks, combining ETF
// constituents with directly-held positions.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import { xrayPortfolio } from "@/lib/finance/xray";
import { hasConstituents } from "@/lib/catalog/catalog";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Card } from "@/components/ui/primitives";

export function XrayView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog(); // recompute once constituents load

  const xray = useMemo(() => {
    const holdings = summarizeAll(data.assets, data.transactions, valuation).filter(
      (h) => h.position.shares > 0,
    );
    return xrayPortfolio(holdings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.assets, data.transactions, valuation, version]);

  const currency = data.profile.currency;

  if (data.assets.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">Add holdings to see your look-through exposure.</p>
      </Card>
    );
  }

  if (xray.exposures.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">
          {hasConstituents()
            ? "None of your holdings have look-through data yet (no stocks or recognised ETFs)."
            : "Constituent data isn't available — connect Supabase and seed the catalog to enable X-ray."}
        </p>
      </Card>
    );
  }

  const maxPercent = xray.exposures[0]?.percent || 1;

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Stock exposure (look-through)</h2>
        <p className="text-sm text-zinc-500">
          {formatNumber((xray.classified / (xray.total || 1)) * 100, 0)}% in equities ·{" "}
          {formatCurrency(xray.unclassified, currency)} other / non-equity
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-3">Stock</th>
              <th className="py-2 pr-3">Held via</th>
              <th className="py-2 pr-3 text-right">Exposure</th>
              <th className="py-2 pr-3 text-right">% of portfolio</th>
            </tr>
          </thead>
          <tbody>
            {xray.exposures.map((e) => (
              <tr
                key={e.key}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
              >
                <td className="py-2 pr-3">
                  <span className="font-medium">{e.name}</span>
                  {e.symbol && (
                    <span className="ml-1 font-mono text-xs text-zinc-500">{e.symbol}</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-zinc-500">
                  {e.sources
                    .map((s) => (s.viaEtf ? s.holdingName : `${s.holdingName} (direct)`))
                    .join(", ")}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatCurrency(e.value, currency)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  <div className="flex items-center justify-end gap-2">
                    <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100 sm:block dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${(e.percent / maxPercent) * 100}%` }}
                      />
                    </div>
                    <span className="w-14 text-right tabular-nums">
                      {formatNumber(e.percent * 100, 2)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        ETF look-through uses representative top holdings; the remainder of each
        fund is counted as “other”.
      </p>
    </Card>
  );
}
