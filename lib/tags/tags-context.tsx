"use client";

// User-defined key-value tag groups per asset, for the Analysis "Custom"
// distribution (switchable per group) and the asset page's tag badges.
// Persisted in localStorage (client-only).

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

export interface TagGroup {
  id: string;
  name: string;
}

/** assetId -> groupId -> values */
export type Assignments = Record<string, Record<string, string[]>>;

interface PersistShape {
  version: 2;
  groups: TagGroup[];
  assignments: Assignments;
}

export interface TagEntry {
  group: TagGroup;
  values: string[];
}

interface TagsContextValue {
  groups: TagGroup[];
  assignments: Assignments;
  valuesFor: (assetId: string, groupId: string) => string[];
  /** All of an asset's groups (in group list order) that carry at least one value. */
  entriesFor: (assetId: string) => TagEntry[];
  /** Distinct sorted values in use anywhere within a group (datalist suggestions). */
  valuesInGroup: (groupId: string) => string[];
  addValue: (assetId: string, groupId: string, value: string) => void;
  removeValue: (assetId: string, groupId: string, value: string) => void;
  /** Creates a group, returning its id. Blank name no-ops (returns ""); an
   * existing group with the same name (case-insensitive) is reused. */
  createGroup: (name: string) => string;
  renameGroup: (groupId: string, name: string) => void;
  deleteGroup: (groupId: string) => void;
}

const TagsContext = createContext<TagsContextValue | null>(null);

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

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
  const assignments: Assignments = {};
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

  const assignments: Assignments = {};
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
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [assignments, setAssignments] = useState<Assignments>({});

  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = migrate(JSON.parse(raw));
          setGroups(parsed.groups);
          setAssignments(parsed.assignments);
        }
      } catch {
        /* ignore */
      }
    });
  }, []);

  const persist = useCallback((next: PersistShape) => {
    setGroups(next.groups);
    setAssignments(next.assignments);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

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
    (assetId: string, groupId: string, value: string) => {
      const v = value.trim();
      if (!v) return;
      const byGroup = assignments[assetId] ?? {};
      const cur = byGroup[groupId] ?? [];
      if (cur.some((x) => x.toLowerCase() === v.toLowerCase())) return;
      const nextAssignments: Assignments = {
        ...assignments,
        [assetId]: { ...byGroup, [groupId]: [...cur, v] },
      };
      persist({ version: 2, groups, assignments: nextAssignments });
    },
    [assignments, groups, persist],
  );

  const removeValue = useCallback(
    (assetId: string, groupId: string, value: string) => {
      const byGroup = assignments[assetId];
      if (!byGroup) return;
      const cur = byGroup[groupId] ?? [];
      const nextValues = cur.filter((x) => x !== value);
      const nextByGroup = { ...byGroup };
      if (nextValues.length) nextByGroup[groupId] = nextValues;
      else delete nextByGroup[groupId];
      const nextAssignments = { ...assignments };
      if (Object.keys(nextByGroup).length) nextAssignments[assetId] = nextByGroup;
      else delete nextAssignments[assetId];
      persist({ version: 2, groups, assignments: nextAssignments });
    },
    [assignments, groups, persist],
  );

  const createGroup = useCallback(
    (name: string): string => {
      const n = name.trim();
      if (!n) return "";
      const existing = groups.find((g) => g.name.toLowerCase() === n.toLowerCase());
      if (existing) return existing.id;
      const id = randomId();
      persist({ version: 2, groups: [...groups, { id, name: n }], assignments });
      return id;
    },
    [groups, assignments, persist],
  );

  const renameGroup = useCallback(
    (groupId: string, name: string) => {
      const n = name.trim();
      if (!n) return;
      const nextGroups = groups.map((g) => (g.id === groupId ? { ...g, name: n } : g));
      persist({ version: 2, groups: nextGroups, assignments });
    },
    [groups, assignments, persist],
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      const nextGroups = groups.filter((g) => g.id !== groupId);
      const nextAssignments: Assignments = {};
      for (const [assetId, byGroup] of Object.entries(assignments)) {
        if (!(groupId in byGroup)) {
          nextAssignments[assetId] = byGroup;
          continue;
        }
        const nextByGroup = { ...byGroup };
        delete nextByGroup[groupId];
        if (Object.keys(nextByGroup).length) nextAssignments[assetId] = nextByGroup;
      }
      persist({ version: 2, groups: nextGroups, assignments: nextAssignments });
    },
    [groups, assignments, persist],
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
