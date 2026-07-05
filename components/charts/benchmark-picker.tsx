"use client";

// Pills to toggle benchmark overlays on a performance chart.

import { BENCHMARKS } from "@/lib/finance/benchmarks";
import { useI18n } from "@/lib/i18n/i18n-context";

export function BenchmarkPicker({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {

  const { t } = useI18n();

  return (
    // Mobile: a single horizontally scrollable row (no page-level scroll,
    // no wrapping over multiple lines) — `min-w-0` lets it shrink inside a
    // flex row so overflow-x-auto actually kicks in instead of stretching
    // the parent. Desktop restores the original wrapping row via md:.
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
    </div>
  );
}
