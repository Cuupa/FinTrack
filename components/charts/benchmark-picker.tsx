"use client";

// Pills to toggle benchmark overlays on a performance chart: the 5 curated
// benchmarks plus any user-added custom ones (any ISIN/WKN/symbol, resolved
// via the shared instrument resolver), with an inline "+" affordance to add
// more.

import { useState } from "react";
import { BENCHMARKS, type Benchmark } from "@/lib/finance/benchmarks";
import { useI18n } from "@/lib/i18n/i18n-context";

export function BenchmarkPicker({
  selected,
  onToggle,
  custom,
  onAddCustom,
  onRemoveCustom,
}: {
  selected: string[];
  onToggle: (id: string) => void;
  custom: Benchmark[];
  onAddCustom: (query: string) => Promise<{ ok: boolean; error?: string }>;
  onRemoveCustom: (id: string) => void;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAdd() {
    setAdding(true);
    setQuery("");
    setError(null);
  }
  function closeAdd() {
    setAdding(false);
    setQuery("");
    setError(null);
  }

  async function submit() {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    const result = await onAddCustom(q);
    setBusy(false);
    if (result.ok) {
      closeAdd();
    } else {
      setError(result.error ?? null);
    }
  }

  return (
    // Mobile: a single horizontally scrollable row (no page-level scroll,
    // no wrapping over multiple lines) — `min-w-0` lets it shrink inside a
    // flex row so overflow-x-auto actually kicks in instead of stretching
    // the parent. Desktop restores the original wrapping row via md:.
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto md:flex-wrap md:overflow-visible">
        <span className="shrink-0 text-xs font-medium text-zinc-500">{t("common.compare")}</span>
        {BENCHMARKS.map((b) => {
          const on = selected.includes(b.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onToggle(b.id)}
              aria-pressed={on}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-transparent text-white"
                  : "border-zinc-300 text-zinc-500 hover:text-zinc-800 dark:border-zinc-700 dark:hover:text-zinc-200"
              }`}
              style={on ? { backgroundColor: b.color } : undefined}
            >
              {b.label}
            </button>
          );
        })}
        {custom.map((b) => {
          const on = selected.includes(b.id);
          return (
            // A <span> wrapper (not a <button>) styled as one pill, holding two
            // sibling buttons — toggle and remove — since nesting an
            // interactive remove control inside the toggle button would be
            // invalid HTML (button-in-button).
            <span
              key={b.id}
              className={`shrink-0 inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-transparent text-white"
                  : "border-zinc-300 text-zinc-500 hover:text-zinc-800 dark:border-zinc-700 dark:hover:text-zinc-200"
              }`}
              style={on ? { backgroundColor: b.color } : undefined}
            >
              <button type="button" onClick={() => onToggle(b.id)} aria-pressed={on}>
                {b.label}
              </button>
              <button
                type="button"
                onClick={() => onRemoveCustom(b.id)}
                aria-label={t("benchmark.remove")}
                title={t("benchmark.remove")}
                className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full leading-none ${
                  on ? "text-white/80 hover:text-white" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                }`}
              >
                ×
              </button>
            </span>
          );
        })}
        {adding ? (
          <span className="inline-flex shrink-0 items-center gap-1">
            {busy ? (
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-600" />
            ) : (
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                  if (e.key === "Escape") closeAdd();
                }}
                placeholder={t("benchmark.searchPlaceholder")}
                aria-label={t("benchmark.searchPlaceholder")}
                className="w-36 rounded-full border border-zinc-300 bg-transparent px-2.5 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            )}
          </span>
        ) : (
          <button
            type="button"
            onClick={openAdd}
            aria-label={t("benchmark.addCustom")}
            title={t("benchmark.addCustom")}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-300 text-zinc-500 hover:border-zinc-500 hover:text-zinc-800 dark:border-zinc-700 dark:hover:text-zinc-200"
          >
            +
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
