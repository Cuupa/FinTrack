"use client";

// User-defined tags per asset (1..n), for the Analysis "Custom" distribution and
// the asset page's tag badges. Persisted in localStorage (client-only).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "fintrack-tags";

type TagMap = Record<string, string[]>; // assetId -> tags

interface TagsContextValue {
  tags: TagMap;
  /** All distinct tag names in use, sorted. */
  allTags: string[];
  tagsFor: (assetId: string) => string[];
  addTag: (assetId: string, tag: string) => void;
  removeTag: (assetId: string, tag: string) => void;
}

const TagsContext = createContext<TagsContextValue | null>(null);

export function TagsProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<TagMap>({});

  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setTags(migrate(JSON.parse(raw)));
      } catch {
        /* ignore */
      }
    });
  }, []);

  const persist = useCallback((next: TagMap) => {
    setTags(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const tagsFor = useCallback((assetId: string) => tags[assetId] ?? [], [tags]);

  const addTag = useCallback(
    (assetId: string, tag: string) => {
      const t = tag.trim();
      if (!t) return;
      const cur = tags[assetId] ?? [];
      if (cur.some((x) => x.toLowerCase() === t.toLowerCase())) return;
      persist({ ...tags, [assetId]: [...cur, t] });
    },
    [tags, persist],
  );

  const removeTag = useCallback(
    (assetId: string, tag: string) => {
      const cur = tags[assetId] ?? [];
      const next = cur.filter((x) => x !== tag);
      const map = { ...tags };
      if (next.length) map[assetId] = next;
      else delete map[assetId];
      persist(map);
    },
    [tags, persist],
  );

  const allTags = useMemo(
    () => Array.from(new Set(Object.values(tags).flat().filter(Boolean))).sort(),
    [tags],
  );

  const value = useMemo<TagsContextValue>(
    () => ({ tags, allTags, tagsFor, addTag, removeTag }),
    [tags, allTags, tagsFor, addTag, removeTag],
  );

  return <TagsContext.Provider value={value}>{children}</TagsContext.Provider>;
}

/** Accept the old single-tag shape (assetId -> string) and upgrade to arrays. */
function migrate(raw: unknown): TagMap {
  if (!raw || typeof raw !== "object") return {};
  const out: TagMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string" && !!x);
    else if (typeof v === "string" && v) out[k] = [v];
  }
  return out;
}

export function useTags(): TagsContextValue {
  const ctx = useContext(TagsContext);
  if (!ctx) throw new Error("useTags must be used within a TagsProvider");
  return ctx;
}
