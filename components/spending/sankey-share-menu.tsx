"use client";

// Share the current cash-flow Sankey as a read-only link — full or incognito
// (relative link widths only). Separate from the portfolio share: the row is
// tagged `mode = "sankey"`, so creating one never voids a portfolio link and
// vice versa. Stored server-side under a short id, with a URL-fragment fallback
// when no backend is available.

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { apiFetch } from "@/lib/api";
import { getSupabaseClient } from "@/lib/supabase/client";
import { encodeShare } from "@/lib/share/share";
import { buildSankeyShare, type SankeySharePayload } from "@/lib/share/sankey-share";
import type { SankeyGraph } from "@/lib/finance/spending";

export function SankeyShareMenu({
  graph,
  labels,
  split,
  currency,
  period,
  periodKind,
}: {
  graph: SankeyGraph;
  labels: { total: string; savings: string; shortfall: string };
  split: { income: number; expense: number; net: number };
  currency: string;
  period: string;
  periodKind: "month" | "timeframe";
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const { data } = usePortfolio();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const disabled = graph.nodes.length === 0;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const share = async (incognito: boolean) => {
    setCreating(true);
    setLink(null);
    setCopied(false);
    // Creating a new Sankey link voids the user's previous ones — but only the
    // Sankey ones, so a portfolio share is left untouched.
    if (user) {
      const supabase = getSupabaseClient();
      await supabase?.from("shared_portfolios").delete().eq("owner", user.id).eq("mode", "sankey");
    }
    const payload = buildSankeyShare({
      graph,
      labels,
      income: split.income,
      expense: split.expense,
      net: split.net,
      currency,
      ownerName: data.profile.name ?? null,
      period,
      periodKind,
      incognito,
    });
    setLink(await createLink(payload, user?.id ?? null));
    setCreating(false);
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(t("share.copy"), link);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t("share.button")}
        aria-label={t("share.button")}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        <span className="hidden sm:inline">{t("share.button")}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => share(false)}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span className="font-medium">{t("sankeyShare.full")}</span>
            <span className="block text-xs text-zinc-500">{t("sankeyShare.fullDesc")}</span>
          </button>
          <button
            type="button"
            onClick={() => share(true)}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span className="font-medium">{t("sankeyShare.incognito")}</span>
            <span className="block text-xs text-zinc-500">{t("sankeyShare.incognitoDesc")}</span>
          </button>

          {(creating || link) && (
            <div className="border-t border-zinc-200 p-2.5 dark:border-zinc-800">
              {creating ? (
                <div className="flex items-center gap-2 px-1 py-1 text-xs text-zinc-500">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-600" />
                  {t("share.creating")}
                </div>
              ) : (
                link && (
                  <div className="flex items-center gap-1.5">
                    <input
                      readOnly
                      value={link}
                      onFocus={(e) => e.currentTarget.select()}
                      className="min-w-0 flex-1 rounded-sm border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-600 outline-none dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
                    />
                    <button
                      type="button"
                      onClick={copy}
                      title={t("share.copy")}
                      aria-label={t("share.copy")}
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                        copied
                          ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                          : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {copied ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Store the snapshot server-side for a short link; fall back to a fragment link. */
async function createLink(payload: SankeySharePayload, owner: string | null): Promise<string> {
  try {
    const res = await apiFetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, owner, mode: "sankey" }),
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      if (data.id) return `${location.origin}/shared/${data.id}`;
    }
  } catch {
    /* fall through to fragment link */
  }
  return `${location.origin}/shared#${encodeShare(payload)}`;
}
