"use client";

// Live-sync indicator: shows whether prices are live, when they last synced,
// and a manual refresh button.

import { useLivePrices } from "@/lib/live/live-prices-context";

export function SyncStatus() {
  const { status, lastSynced, tracked, refresh } = useLivePrices();

  if (tracked === 0) return null;

  const dot =
    status === "live"
      ? "bg-emerald-500"
      : status === "syncing"
        ? "bg-amber-400 animate-pulse"
        : status === "error"
          ? "bg-red-500"
          : "bg-zinc-400";

  const label =
    status === "live"
      ? lastSynced
        ? `Live · ${time(lastSynced)}`
        : "Live"
      : status === "syncing"
        ? "Syncing…"
        : status === "error"
          ? "Offline"
          : "Idle";

  return (
    <button
      onClick={refresh}
      title={`${tracked} asset${tracked === 1 ? "" : "s"} tracked — click to refresh`}
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {label}
      <span aria-hidden className="text-zinc-400">
        ↻
      </span>
    </button>
  );
}

function time(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}
