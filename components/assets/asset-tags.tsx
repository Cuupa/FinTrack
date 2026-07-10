"use client";

// Per-asset tags shown as coloured badges (each colour matches the asset's slice
// in the Analysis "Custom" pie). Add via the inline input; remove via the × on a
// badge. Stored client-side via the tags context.

import { useState } from "react";
import { useTags } from "@/lib/tags/tags-context";
import { colorForLabel } from "@/lib/colors";

export function AssetTags({ assetId }: { assetId: string }) {
  // Temporary compile-safe wiring against the new grouped-tags API; the real
  // group-aware editor (group picker, group manager) lands in the next commit.
  const { groups, entriesFor, addValue, removeValue } = useTags();
  const entries = entriesFor(assetId);
  const groupId = groups[0]?.id ?? "";
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);

  const commit = () => {
    const t = input.trim();
    if (t && groupId) addValue(assetId, groupId, t);
    setInput("");
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {entries.flatMap(({ group, values }) =>
        values.map((value) => (
          <span
            key={`${group.id}:${value}`}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white"
            style={{ backgroundColor: colorForLabel(value) }}
          >
            {group.name}: {value}
            <button
              type="button"
              onClick={() => removeValue(assetId, group.id, value)}
              aria-label={`Remove tag ${value}`}
              className="text-white/80 hover:text-white"
            >
              ✕
            </button>
          </span>
        )),
      )}

      {adding ? (
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setInput("");
              setAdding(false);
            }
          }}
          onBlur={commit}
          placeholder="Tag…"
          className="w-24 rounded-full border border-zinc-300 bg-transparent px-2.5 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:hover:text-zinc-300"
        >
          + Tag
        </button>
      )}
    </div>
  );
}
