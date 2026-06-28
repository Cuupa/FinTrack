"use client";

// Multiselect dropdown that scopes an analysis view to a subset of holdings.
// No selection = "Portfolio wide" (all holdings).

import { useEffect, useRef, useState } from "react";

export interface ScopeOption {
  id: string;
  label: string;
}

export function ScopeSelect({
  options,
  selected,
  onChange,
}: {
  options: ScopeOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const summary =
    selected.length === 0
      ? "Portfolio wide"
      : selected.length === 1
        ? (options.find((o) => o.id === selected[0])?.label ?? "1 selected")
        : `${selected.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <span className="text-zinc-400">Scope:</span>
        {summary}
        <span className="text-[10px] text-zinc-400">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 max-h-80 w-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => onChange([])}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              selected.length === 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""
            }`}
          >
            Portfolio wide
          </button>
          <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          {options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.id)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                    on
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-zinc-300 dark:border-zinc-600"
                  }`}
                >
                  {on ? "✓" : ""}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
