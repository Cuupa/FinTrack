"use client";

// Create a shareable portfolio link — full or incognito (relative figures only).
// The snapshot (allocation + TWROR/wealth series + IRR + holdings) is stored
// server-side under a short id; if that's unavailable it falls back to encoding
// the snapshot in the URL fragment.

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { apiFetch } from "@/lib/api";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useShareSource } from "@/lib/share/use-share-source";
import { buildSharePayload, encodeShare, type SharePayload } from "@/lib/share/share";

export function ShareMenu() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { portfolios, selectedPortfolioIds } = usePortfolio();
  // Explicit portfolio choice for the share, seeded from the header selection.
  const [chosenIds, setChosenIds] = useState<string[]>(selectedPortfolioIds);
  const { source, loading } = useShareSource(chosenIds);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const togglePortfolio = (id: string) =>
    setChosenIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

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
    // Live shares require an account (the owner keeps them refreshed).
    const isLive = live && !!user;
    // Creating a new link voids the user's previous ones.
    if (user) {
      const supabase = getSupabaseClient();
      await supabase?.from("shared_portfolios").delete().eq("owner", user.id);
    }
    const payload = buildSharePayload(source, incognito, isLive);
    const url = await createLink(payload, user?.id ?? null);
    setLink(url);
    setCreating(false);
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this share link:", link);
    }
  };

  const disabled = source.holdings.length === 0 || loading;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t("share.button")}
        aria-label={t("share.button")}
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
        <span className="hidden sm:inline">{t("share.button")}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {/* Snapshot vs Live mode. Live keeps the shared view in sync as the
              owner's portfolio changes; it needs an account. */}
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {live ? t("share.live") : t("share.snapshot")}
              </div>
              <div className="text-xs text-zinc-500">
                {live ? t("share.liveDesc") : t("share.snapshotDesc")}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={live}
              disabled={!user}
              title={user ? t("share.live") : t("share.liveHint")}
              onClick={() => setLive((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
                live ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  live ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {portfolios.length > 1 && (
            <div className="border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
              <div className="mb-1.5 text-xs font-medium text-zinc-500">{t("share.portfolios")}</div>
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                {portfolios.map((p) => {
                  const on = chosenIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePortfolio(p.id)}
                      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                          on ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-zinc-600"
                        }`}
                      >
                        {on ? "✓" : ""}
                      </span>
                      <span className="truncate">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => share(false)}
            disabled={chosenIds.length === 0}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <span className="font-medium">{t("share.full")}</span>
            <span className="block text-xs text-zinc-500">{t("share.fullDesc")}</span>
          </button>
          <button
            type="button"
            onClick={() => share(true)}
            disabled={chosenIds.length === 0}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <span className="font-medium">{t("share.incognito")}</span>
            <span className="block text-xs text-zinc-500">{t("share.incognitoDesc")}</span>
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
                      className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-600 outline-none dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
                    />
                    <button
                      type="button"
                      onClick={copy}
                      title={t("share.copy")}
                      aria-label={t("share.copy")}
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
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
async function createLink(payload: SharePayload, owner: string | null): Promise<string> {
  try {
    const res = await apiFetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, owner, mode: payload.live ? "live" : "snapshot" }),
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
