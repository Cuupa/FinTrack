"use client";

// Per-asset tags shown as coloured badges (each colour matches the asset's slice
// in the Analysis "Custom" pie). Add via the inline input; remove via the × on a
// badge. Stored client-side via the tags context.

import { useState } from "react";
import { useTags } from "@/lib/tags/tags-context";
import { colorForLabel } from "@/lib/colors";

export function AssetTags({ assetId }: { assetId: string }) {
  const { tagsFor, allTags, addTag, removeTag } = useTags();
  const tags = tagsFor(assetId);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);

  const commit = () => {
    const t = input.trim();
    if (t) addTag(assetId, t);
    setInput("");
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white"
          style={{ backgroundColor: colorForLabel(tag) }}
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(assetId, tag)}
            aria-label={`Remove tag ${tag}`}
            className="text-white/80 hover:text-white"
          >
            ✕
          </button>
        </span>
      ))}

      {adding ? (
        <input
          autoFocus
          list="asset-tag-suggestions"
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
      <datalist id="asset-tag-suggestions">
        {allTags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}
