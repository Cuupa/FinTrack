"use client";

// Create a shareable portfolio link — full or incognito (relative figures only).
// The snapshot (allocation + TWROR/wealth series + IRR + holdings) is stored
// server-side under a short id; if that's unavailable it falls back to encoding
// the snapshot in the URL fragment.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { netWorthSeries, summarizeAll, twrSeries } from "@/lib/finance/portfolio";
import { netFlows } from "@/lib/finance/returns";
import { portfolioIRR } from "@/lib/finance/irr";
import { apiFetch } from "@/lib/api";
import {
  buildSharePayload,
  encodeShare,
  type ShareSource,
  type SharePayload,
} from "@/lib/share/share";

export function ShareMenu() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const currency = data.profile.currency;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const histItems = useMemo(
    () =>
      data.assets.map(quoteItemFor).filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const { histories, loading } = useHistory(histItems, "MAX", currency);

  const source = useMemo<ShareSource>(() => {
    const holdings = summarizeAll(data.assets, data.transactions, valuation).filter(
      (h) => h.position.shares > 0,
    );
    const netWorth = holdings.reduce((s, h) => s + h.marketValue, 0);
    const wealthSeries = netWorthSeries(data.assets, data.transactions, "MAX", valuation, histories);
    const twr = twrSeries(data.assets, data.transactions, "MAX", valuation, histories);
    const flows = netFlows(data.assets, data.transactions, valuation).map((f) => ({
      date: f.date,
      amount: -f.amount,
    }));
    return {
      currency,
      netWorth,
      irr: portfolioIRR(flows, netWorth),
      twr: twr.length ? twr[twr.length - 1].value : null,
      twrSeries: twr,
      wealthSeries,
      holdings: holdings.map((h) => ({
        name: h.asset.name,
        type: h.asset.type,
        marketValue: h.marketValue,
        ret: h.unrealizedPLPercent,
      })),
    };
  }, [data, valuation, histories, currency]);

  const share = async (incognito: boolean) => {
    setOpen(false);
    setStatus("Creating link…");
    const payload = buildSharePayload(source, incognito);
    const link = await createLink(payload);
    try {
      await navigator.clipboard.writeText(link);
      setStatus(incognito ? "Incognito link copied" : "Link copied");
    } catch {
      window.prompt("Copy this share link:", link);
      setStatus(null);
    }
    setTimeout(() => setStatus(null), 2500);
  };

  const disabled = source.holdings.length === 0 || loading;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Share portfolio"
        aria-label="Share portfolio"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        {status && <span className="hidden sm:inline">{status}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => share(false)}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span className="font-medium">Share full portfolio</span>
            <span className="block text-xs text-zinc-500">Includes absolute amounts.</span>
          </button>
          <button
            type="button"
            onClick={() => share(true)}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span className="font-medium">Share in incognito</span>
            <span className="block text-xs text-zinc-500">
              Allocations &amp; returns only — no amounts.
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Store the snapshot server-side for a short link; fall back to a fragment link. */
async function createLink(payload: SharePayload): Promise<string> {
  try {
    const res = await apiFetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    if (res.ok) {
      const { id } = (await res.json()) as { id?: string };
      if (id) return `${location.origin}/shared/${id}`;
    }
  } catch {
    /* fall through to fragment link */
  }
  return `${location.origin}/shared#${encodeShare(payload)}`;
}
