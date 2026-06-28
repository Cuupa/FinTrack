"use client";

// Create a shareable permalink to the portfolio — either full or incognito
// (relative figures only). The snapshot lives entirely in the URL fragment.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import { buildSharePayload, encodeShare, type ShareSource } from "@/lib/share/share";
import { Button } from "@/components/ui/primitives";

export function ShareMenu() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const source = useMemo<ShareSource>(() => {
    const holdings = summarizeAll(data.assets, data.transactions, valuation).filter(
      (h) => h.position.shares > 0,
    );
    return {
      currency: data.profile.currency,
      netWorth: holdings.reduce((s, h) => s + h.marketValue, 0),
      holdings: holdings.map((h) => ({
        name: h.asset.name,
        type: h.asset.type,
        marketValue: h.marketValue,
        ret: h.unrealizedPLPercent,
      })),
    };
  }, [data, valuation]);

  const share = async (incognito: boolean) => {
    const link = `${location.origin}/shared#${encodeShare(buildSharePayload(source, incognito))}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(incognito ? "Incognito link copied" : "Link copied");
    } catch {
      // Fallback: open it so the user can copy from the address bar.
      window.prompt("Copy this share link:", link);
      setCopied(null);
    }
    setTimeout(() => setCopied(null), 2500);
    setOpen(false);
  };

  const disabled = source.holdings.length === 0;

  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        {copied ?? "Share"}
      </Button>
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
              Allocations &amp; returns only — no amounts, uncoverable.
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
