"use client";

// Read-only shared portfolio view. The snapshot is decoded entirely from the URL
// fragment — nothing is fetched. Incognito shares contain no absolute figures at
// all, so there is no control (and no data) to reveal them.

import { useEffect, useState } from "react";
import Link from "next/link";
import { decodeShare, type SharePayload } from "@/lib/share/share";
import { formatCurrency, formatPercent, formatNumber, plColor } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { AllocationPie } from "@/components/allocation/allocation-pie";

export default function SharedPage() {
  const [payload, setPayload] = useState<SharePayload | null | "missing">(null);

  useEffect(() => {
    // Async continuation so this isn't a synchronous setState in an effect.
    void Promise.resolve().then(() => {
      const frag = window.location.hash.replace(/^#/, "");
      setPayload(frag ? (decodeShare(frag) ?? "missing") : "missing");
    });
  }, []);

  if (payload === null) {
    return <div className="py-16 text-center text-sm text-zinc-500">Loading…</div>;
  }

  if (payload === "missing") {
    return (
      <Card>
        <p className="text-sm text-zinc-500">
          This share link is empty or invalid.{" "}
          <Link href="/" className="text-emerald-600 hover:underline dark:text-emerald-400">
            Go to FinTrack
          </Link>
        </p>
      </Card>
    );
  }

  const { incognito, currency, holdings, netWorth } = payload;
  const slices = holdings.map((h) => ({ label: h.name, value: h.allocation }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shared portfolio</h1>
          <p className="text-sm text-zinc-500">
            A read-only snapshot{incognito ? " (incognito — amounts hidden)" : ""}.
          </p>
        </div>
        {incognito && (
          <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-700">
            Incognito
          </span>
        )}
      </div>

      {!incognito && netWorth != null && (
        <Card>
          <div className="text-sm text-zinc-500">Net worth</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatCurrency(netWorth, currency)}
          </div>
        </Card>
      )}

      {slices.length > 0 && (
        <Card>
          <h2 className="mb-4 text-sm font-semibold">Allocation</h2>
          {/* Pie is share-of-100% from the weights; centre total reads 100%. */}
          <AllocationPie slices={slices} currency={currency} />
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold">Holdings</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3 text-right">Allocation</th>
                <th className="py-2 pr-3 text-right">Return</th>
                {!incognito && <th className="py-2 pr-3 text-right">Value</th>}
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => (
                <tr
                  key={`${h.name}-${i}`}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                >
                  <td className="py-2 pr-3 font-medium">{h.name}</td>
                  <td className="py-2 pr-3 text-zinc-500">{h.type}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatNumber(h.allocation * 100, 1)}%
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${plColor(h.ret)}`}>
                    {formatPercent(h.ret)}
                  </td>
                  {!incognito && (
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {h.value != null ? formatCurrency(h.value, currency) : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-center text-xs text-zinc-400">
        Powered by{" "}
        <Link href="/" className="hover:underline">
          FinTrack
        </Link>
      </p>
    </div>
  );
}
