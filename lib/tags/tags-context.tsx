"use client";

// User-defined key-value tag groups per asset, for the Analysis "Custom"
// distribution (switchable per group) and the asset page's tag badges. Rides
// the DataStore seam (lib/store) like watchlist/savings plans: DB-persisted
// for registered users, localStorage-backed (inside the portfolio blob) for
// guests. This module is a thin adapter over `usePortfolio()` that keeps the
// original consumer-facing shape (`groups`, `assignments`, `valuesFor`, …) so
// components didn't need to change, only handle the mutators now returning
// Promises.
//
// One-time migration: tags used to live entirely in a separate `fintrack-tags`
// localStorage key, for every user (guest and registered alike). On mount,
// once portfolio data has loaded, if the store has zero tag groups and that
// legacy key still holds data, it's replayed into the store (group ids are
// remapped since the store mints new ones) and the key is renamed to
// `fintrack-tags-imported` so it never replays again.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import type { TagAssignments, TagGroup } from "@/lib/types";

export type { TagGroup };
/** @deprecated alias kept for the pre-seam shape; prefer `TagAssignments`. */
export type Assignments = TagAssignments;

const STORAGE_KEY = "fintrack-tags";
const STORAGE_KEY_IMPORTED = "fintrack-tags-imported";

interface PersistShape {
  version: 2;
  groups: TagGroup[];
  assignments: TagAssignments;
}

export interface TagEntry {
  group: TagGroup;
  values: string[];
}

interface TagsContextValue {
  groups: TagGroup[];
  assignments: TagAssignments;
  valuesFor: (assetId: string, groupId: string) => string[];
  /** All of an asset's groups (in group list order) that carry at least one value. */
  entriesFor: (assetId: string) => TagEntry[];
  /** Distinct sorted values in use anywhere within a group (datalist suggestions). */
  valuesInGroup: (groupId: string) => string[];
  addValue: (assetId: string, groupId: string, value: string) => Promise<void>;
  removeValue: (assetId: string, groupId: string, value: string) => Promise<void>;
  /** Creates a group, returning its id. Blank name no-ops (returns ""); an
   * existing group with the same name (case-insensitive) is reused. */
  createGroup: (name: string) => Promise<string>;
  renameGroup: (groupId: string, name: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
}

const TagsContext = createContext<TagsContextValue | null>(null);

/** Upgrade the pre-groups shape (assetId -> tag[]) into a single "default" group. */
function migrateLegacyTagMap(raw: unknown): PersistShape {
  if (!raw || typeof raw !== "object") return { version: 2, groups: [], assignments: {} };
  const legacy: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      const vals = v.filter((x): x is string => typeof x === "string" && !!x);
      if (vals.length) legacy[k] = vals;
    } else if (typeof v === "string" && v) {
      legacy[k] = [v];
    }
  }
  if (Object.keys(legacy).length === 0) return { version: 2, groups: [], assignments: {} };
  const assignments: TagAssignments = {};
  for (const [assetId, values] of Object.entries(legacy)) {
    assignments[assetId] = { default: values };
  }
  return { version: 2, groups: [{ id: "default", name: "Tags" }], assignments };
}

/** Normalize a v2 shape, dropping malformed groups/assignment entries. */
function normalizeV2(raw: Record<string, unknown>): PersistShape {
  const groups: TagGroup[] = Array.isArray(raw.groups)
    ? raw.groups.filter(
        (g): g is TagGroup =>
          !!g &&
          typeof g === "object" &&
          typeof (g as TagGroup).id === "string" &&
          typeof (g as TagGroup).name === "string",
      )
    : [];

  const assignments: TagAssignments = {};
  const rawAssignments = raw.assignments;
  if (rawAssignments && typeof rawAssignments === "object") {
    for (const [assetId, byGroup] of Object.entries(rawAssignments as Record<string, unknown>)) {
      if (!byGroup || typeof byGroup !== "object") continue;
      const groupMap: Record<string, string[]> = {};
      for (const [groupId, values] of Object.entries(byGroup as Record<string, unknown>)) {
        if (!Array.isArray(values)) continue;
        const vals = values.filter((x): x is string => typeof x === "string" && !!x);
        if (vals.length) groupMap[groupId] = vals;
      }
      if (Object.keys(groupMap).length) assignments[assetId] = groupMap;
    }
  }

  return { version: 2, groups, assignments };
}

/** Accepts either the current v2 shape or the legacy pre-groups shape. */
export function migrate(raw: unknown): PersistShape {
  if (raw && typeof raw === "object" && (raw as { version?: unknown }).version === 2) {
    return normalizeV2(raw as Record<string, unknown>);
  }
  return migrateLegacyTagMap(raw);
}

export function TagsProvider({ children }: { children: ReactNode }) {
  const {
    data,
    loading,
    addTagGroup: storeAddTagGroup,
    renameTagGroup: storeRenameTagGroup,
    deleteTagGroup: storeDeleteTagGroup,
    setAssetTags: storeSetAssetTags,
  } = usePortfolio();
  const groups = data.tagGroups;
  const assignments = data.tagAssignments;

  // Guards the one-time legacy-key import against concurrent re-entry (e.g.
  // React StrictMode's double effect invocation in dev) — not a permanent
  // latch, so a later store swap (guest -> registered sign-in) can still be
  // checked; the actual "never twice" guarantee comes from the store having
  // groups already, or the legacy key having been renamed away.
  const migrating = useRef(false);

  useEffect(() => {
    if (loading || migrating.current) return;
    if (groups.length > 0) return; // store already has groups — nothing to migrate
    migrating.current = true;
    const assets = data.assets;
    void Promise.resolve()
      .then(async () => {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return;
          const parsed = migrate(JSON.parse(raw));
          if (parsed.groups.length === 0) return;

          const idMap: Record<string, string> = {};
          for (const g of parsed.groups) {
            const created = await storeAddTagGroup(g.name);
            idMap[g.id] = created.id;
          }
          const assetIds = new Set(assets.map((a) => a.id));
          for (const [assetId, byGroup] of Object.entries(parsed.assignments)) {
            if (!assetIds.has(assetId)) continue;
            for (const [legacyGroupId, values] of Object.entries(byGroup)) {
              const newGroupId = idMap[legacyGroupId];
              if (!newGroupId || values.length === 0) continue;
              await storeSetAssetTags(assetId, newGroupId, values);
            }
          }
          // Keep the payload as a backup but stop it from ever replaying again.
          localStorage.setItem(STORAGE_KEY_IMPORTED, raw);
          localStorage.removeItem(STORAGE_KEY);
        } catch (err) {
          console.error("Failed to migrate legacy localStorage tags", err);
        }
      })
      .finally(() => {
        migrating.current = false;
      });
  }, [loading, groups.length, data.assets, storeAddTagGroup, storeSetAssetTags]);

  const valuesFor = useCallback(
    (assetId: string, groupId: string) => assignments[assetId]?.[groupId] ?? [],
    [assignments],
  );

  const entriesFor = useCallback(
    (assetId: string): TagEntry[] => {
      const byGroup = assignments[assetId];
      if (!byGroup) return [];
      const out: TagEntry[] = [];
      for (const group of groups) {
        const values = byGroup[group.id];
        if (values && values.length) out.push({ group, values });
      }
      return out;
    },
    [assignments, groups],
  );

  const valuesInGroup = useCallback(
    (groupId: string) => {
      const set = new Set<string>();
      for (const byGroup of Object.values(assignments)) {
        for (const v of byGroup[groupId] ?? []) set.add(v);
      }
      return Array.from(set).sort();
    },
    [assignments],
  );

  const addValue = useCallback(
    async (assetId: string, groupId: string, value: string) => {
      const v = value.trim();
      if (!v) return;
      const cur = assignments[assetId]?.[groupId] ?? [];
      if (cur.some((x) => x.toLowerCase() === v.toLowerCase())) return;
      await storeSetAssetTags(assetId, groupId, [...cur, v]);
    },
    [assignments, storeSetAssetTags],
  );

  const removeValue = useCallback(
    async (assetId: string, groupId: string, value: string) => {
      const cur = assignments[assetId]?.[groupId] ?? [];
      const next = cur.filter((x) => x !== value);
      if (next.length === cur.length) return; // nothing to remove
      await storeSetAssetTags(assetId, groupId, next);
    },
    [assignments, storeSetAssetTags],
  );

  const createGroup = useCallback(
    async (name: string): Promise<string> => {
      const n = name.trim();
      if (!n) return "";
      const existing = groups.find((g) => g.name.toLowerCase() === n.toLowerCase());
      if (existing) return existing.id;
      const group = await storeAddTagGroup(n);
      return group.id;
    },
    [groups, storeAddTagGroup],
  );

  const renameGroup = useCallback(
    async (groupId: string, name: string) => {
      const n = name.trim();
      if (!n) return;
      await storeRenameTagGroup(groupId, n);
    },
    [storeRenameTagGroup],
  );

  const deleteGroup = useCallback(
    async (groupId: string) => {
      await storeDeleteTagGroup(groupId);
    },
    [storeDeleteTagGroup],
  );

  const value = useMemo<TagsContextValue>(
    () => ({
      groups,
      assignments,
      valuesFor,
      entriesFor,
      valuesInGroup,
      addValue,
      removeValue,
      createGroup,
      renameGroup,
      deleteGroup,
    }),
    [
      groups,
      assignments,
      valuesFor,
      entriesFor,
      valuesInGroup,
      addValue,
      removeValue,
      createGroup,
      renameGroup,
      deleteGroup,
    ],
  );

  return <TagsContext.Provider value={value}>{children}</TagsContext.Provider>;
}

export function useTags(): TagsContextValue {
  const ctx = useContext(TagsContext);
  if (!ctx) throw new Error("useTags must be used within a TagsProvider");
  return ctx;
}
