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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-zinc-500">{t("common.compare")}</span>
      {BENCHMARKS.map((b) => {
        const on = selected.includes(b.id);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onToggle(b.id)}
            aria-pressed={on}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
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
