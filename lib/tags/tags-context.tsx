"use client";

// User-defined custom tags (categories) per asset, for the Analysis "Custom"
// distribution. One category per asset keeps the breakdown a clean part-of-whole
// pie. Persisted in localStorage (client-only, no server round-trip).

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

type TagMap = Record<string, string>; // assetId -> tag

interface TagsContextValue {
  tags: TagMap;
  /** All distinct tag names in use, sorted. */
  allTags: string[];
  setTag: (assetId: string, tag: string) => void;
  clearTag: (assetId: string) => void;
}

const TagsContext = createContext<TagsContextValue | null>(null);

export function TagsProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<TagMap>({});

  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setTags(JSON.parse(raw) as TagMap);
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

  const setTag = useCallback(
    (assetId: string, tag: string) => {
      const t = tag.trim();
      persist({ ...tags, [assetId]: t });
    },
    [tags, persist],
  );

  const clearTag = useCallback(
    (assetId: string) => {
      const next = { ...tags };
      delete next[assetId];
      persist(next);
    },
    [tags, persist],
  );

  const allTags = useMemo(
    () => Array.from(new Set(Object.values(tags).filter(Boolean))).sort(),
    [tags],
  );

  const value = useMemo<TagsContextValue>(
    () => ({ tags, allTags, setTag, clearTag }),
    [tags, allTags, setTag, clearTag],
  );

  return <TagsContext.Provider value={value}>{children}</TagsContext.Provider>;
}

export function useTags(): TagsContextValue {
  const ctx = useContext(TagsContext);
  if (!ctx) throw new Error("useTags must be used within a TagsProvider");
  return ctx;
}
