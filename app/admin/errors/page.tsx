"use client";

// Error-log viewer: public.error_logs is world-nonreadable except for admins
// (RLS policy "error logs admin readable" using public.is_admin(), migration
// 0051), so this queries the table straight from the browser client, same
// idiom as app/admin/prices/page.tsx reading `instruments` directly. Newest
// first, capped at 500 rows — the 30-day retention cron
// (app/api/cron/sync/error-logs) keeps the table small enough that this cap
// is a safety valve, not a real pagination need.
//
// Severity `level` (debug|info|warn|error|fatal, migration 0069) is the
// primary classification and admin filter; `kind` (boundary/window/
// unhandledrejection, the capture source) stays a secondary plain column.
// Filters (level, free-text, date-from) run client-side over the fetched
// batch, matching admin/prices's filter pattern. Every column is sortable
// (same Th/sort-state idiom as app/admin/prices/page.tsx) and rows highlight
// on hover. "Purge all" / "Purge older than 7 days" go through DELETE
// /api/admin/errors (requireAdmin + secret client — error_logs has no client
// delete policy) behind the app's ConfirmDialog, per the house rule that
// every destructive action confirms first.

import { Fragment, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatInstant } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectMenu } from "@/components/ui/select-menu";
import { adminAuthToken, adminDelete } from "@/lib/admin/client";

interface ErrorLogRow {
  id: string;
  kind: string;
  level: string;
  message: string | null;
  stack: string | null;
  route: string | null;
  digest: string | null;
  user_agent: string | null;
  created_at: string;
}

type ErrorLevel = "debug" | "info" | "warn" | "error" | "fatal";
type LevelFilter = "all" | ErrorLevel;
type PurgeTarget = "all" | "old" | null;
type SortKey = "level" | "kind" | "message" | "route" | "digest" | "created" | "userAgent";

const ROW_LIMIT = 500;

// Severity rank, low to high, used both for the default level sort order and
// as the fallback when a row somehow carries an unexpected value.
const LEVEL_RANK: Record<ErrorLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

// Plain-text color coding, no badges/pills/chips anywhere in this app.
const LEVEL_CLASS: Record<ErrorLevel, string> = {
  debug: "text-zinc-400 dark:text-zinc-500",
  info: "text-blue-600 dark:text-blue-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
  fatal: "text-red-600 dark:text-red-400 font-semibold",
};

// Literal dictionary keys (not a template string) so `t()`'s key union stays
// exhaustive and typo-proof.
const LEVEL_LABEL_KEY: Record<ErrorLevel, MessageKey> = {
  debug: "admin.errors.levelDebug",
  info: "admin.errors.levelInfo",
  warn: "admin.errors.levelWarn",
  error: "admin.errors.levelError",
  fatal: "admin.errors.levelFatal",
};

function levelRank(level: string): number {
  return level in LEVEL_RANK ? LEVEL_RANK[level as ErrorLevel] : -1;
}

function levelClass(level: string): string {
  return level in LEVEL_CLASS ? LEVEL_CLASS[level as ErrorLevel] : "text-zinc-500";
}

function levelLabelKey(level: string): MessageKey {
  return level in LEVEL_LABEL_KEY ? LEVEL_LABEL_KEY[level as ErrorLevel] : "admin.errors.levelError";
}

export default function AdminErrorsPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ErrorLogRow[] | null>(null);
  const [rowsVersion, setRowsVersion] = useState(0);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget>(null);
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created", dir: -1 });

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("error_logs")
      .select("id, kind, level, message, stack, route, digest, user_agent, created_at")
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT)
      .then(({ data }) => {
        if (!active) return;
        setRows((data ?? []) as ErrorLogRow[]);
      });
    return () => {
      active = false;
    };
  }, [rowsVersion]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    const list = (rows ?? []).filter((r) => {
      if (levelFilter !== "all" && r.level !== levelFilter) return false;
      if (fromMs != null && Date.parse(r.created_at) < fromMs) return false;
      if (!q) return true;
      return (
        (r.message ?? "").toLowerCase().includes(q) ||
        (r.route ?? "").toLowerCase().includes(q) ||
        (r.digest ?? "").toLowerCase().includes(q)
      );
    });
    const dir = sort.dir;
    return [...list].sort((a, b) => compare(a, b, sort.key) * dir);
  }, [rows, levelFilter, query, dateFrom, sort]);

  const purge = async (target: PurgeTarget) => {
    if (!target) return;
    setError(null);
    setPurging(true);
    try {
      const token = await adminAuthToken();
      if (!token) throw new Error();
      const body = target === "old" ? { olderThanDays: 7 } : {};
      await adminDelete("/api/admin/errors", body, token);
      setRowsVersion((v) => v + 1);
    } catch {
      setError(t("admin.errors.error"));
    } finally {
      setPurging(false);
      setPurgeTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.errors.title")}</h1>
        <p className="text-sm text-zinc-500">{t("admin.errors.subtitle")}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-zinc-500">{t("admin.errors.colLevel")}</label>
            <SelectMenu
              value={levelFilter}
              onChange={(v) => setLevelFilter(v as LevelFilter)}
              className="mt-1 w-48"
              ariaLabel={t("admin.errors.colLevel")}
              options={[
                { value: "all", label: t("admin.errors.levelAll") },
                { value: "debug", label: t("admin.errors.levelDebug") },
                { value: "info", label: t("admin.errors.levelInfo") },
                { value: "warn", label: t("admin.errors.levelWarn") },
                { value: "error", label: t("admin.errors.levelError") },
                { value: "fatal", label: t("admin.errors.levelFatal") },
              ]}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs text-zinc-500">{t("admin.errors.filterLabel")}</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("admin.errors.filterPlaceholder")}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">{t("admin.errors.dateFromLabel")}</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPurgeTarget("old")}
              disabled={purging || (rows?.length ?? 0) === 0}
            >
              {t("admin.errors.purgeOld")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setPurgeTarget("all")}
              disabled={purging || (rows?.length ?? 0) === 0}
            >
              {t("admin.errors.purgeAll")}
            </Button>
          </div>
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
          <div>
            <dt className="inline font-medium text-zinc-600 dark:text-zinc-400">
              {t("admin.errors.kindBoundary")}:
            </dt>{" "}
            <dd className="inline">{t("admin.errors.kindBoundaryHelp")}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-zinc-600 dark:text-zinc-400">
              {t("admin.errors.kindWindow")}:
            </dt>{" "}
            <dd className="inline">{t("admin.errors.kindWindowHelp")}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-zinc-600 dark:text-zinc-400">
              {t("admin.errors.kindUnhandledrejection")}:
            </dt>{" "}
            <dd className="inline">{t("admin.errors.kindUnhandledrejectionHelp")}</dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-zinc-500">
          {t("admin.errors.count", { count: String(filtered.length), total: String(rows?.length ?? 0) })}
        </p>

        <div className="mt-3 overflow-x-auto">
          {rows === null ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {rows.length === 0 ? t("admin.errors.empty") : t("admin.errors.noMatch")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <Th label={t("admin.errors.colLevel")} k="level" sort={sort} onSort={toggleSort} />
                  <Th label={t("admin.errors.colKind")} k="kind" sort={sort} onSort={toggleSort} />
                  <Th label={t("admin.errors.colMessage")} k="message" sort={sort} onSort={toggleSort} />
                  <Th label={t("admin.errors.colRoute")} k="route" sort={sort} onSort={toggleSort} />
                  <Th label={t("admin.errors.colDigest")} k="digest" sort={sort} onSort={toggleSort} />
                  <Th label={t("admin.errors.colCreated")} k="created" sort={sort} onSort={toggleSort} />
                  <Th
                    label={t("admin.errors.colUserAgent")}
                    k="userAgent"
                    sort={sort}
                    onSort={toggleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isExpanded = expanded === r.id;
                  const shortMessage = (r.message ?? "").slice(0, 80);
                  const hasMore = (r.message ?? "").length > 80 || !!r.stack;
                  return (
                    <Fragment key={r.id}>
                      <tr className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
                        <td className={`px-3 py-2 align-top text-xs ${levelClass(r.level)}`}>
                          {t(levelLabelKey(r.level))}
                        </td>
                        <td className="px-3 py-2 align-top font-mono text-xs text-zinc-500">{r.kind}</td>
                        <td className="max-w-xs px-3 py-2 align-top">
                          <div className="truncate">{shortMessage || "—"}</div>
                          {hasMore && (
                            <button
                              type="button"
                              onClick={() => setExpanded(isExpanded ? null : r.id)}
                              className="mt-1 text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
                            >
                              {isExpanded ? t("admin.errors.collapse") : t("admin.errors.expand")}
                            </button>
                          )}
                        </td>
                        <td className="max-w-[10rem] truncate px-3 py-2 align-top font-mono text-xs text-zinc-500">
                          {r.route ?? "—"}
                        </td>
                        <td className="px-3 py-2 align-top font-mono text-xs text-zinc-500">
                          {r.digest ?? "—"}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-zinc-500 whitespace-nowrap">
                          {formatInstant(r.created_at)}
                        </td>
                        <td className="max-w-[12rem] truncate px-3 py-2 align-top text-xs text-zinc-500">
                          {r.user_agent ?? "—"}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-zinc-100 dark:border-zinc-800/60">
                          <td colSpan={7} className="bg-zinc-50 px-3 py-3 dark:bg-zinc-900/40">
                            <p className="whitespace-pre-wrap break-words text-xs">
                              {r.message || t("admin.errors.noStack")}
                            </p>
                            {r.stack && (
                              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-100 p-2 font-mono text-[11px] text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                                {r.stack}
                              </pre>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={purgeTarget !== null}
        title={
          purgeTarget === "all"
            ? t("admin.errors.purgeAllConfirmTitle")
            : t("admin.errors.purgeOldConfirmTitle")
        }
        message={
          purgeTarget === "all"
            ? t("admin.errors.purgeAllConfirmMsg")
            : t("admin.errors.purgeOldConfirmMsg")
        }
        confirmLabel={purgeTarget === "all" ? t("admin.errors.purgeAll") : t("admin.errors.purgeOld")}
        onConfirm={() => purge(purgeTarget)}
        onCancel={() => setPurgeTarget(null)}
      />
    </div>
  );
}

function compare(a: ErrorLogRow, b: ErrorLogRow, key: SortKey): number {
  switch (key) {
    case "level":
      return levelRank(a.level) - levelRank(b.level);
    case "kind":
      return a.kind.localeCompare(b.kind);
    case "message":
      return (a.message ?? "").localeCompare(b.message ?? "");
    case "route":
      return (a.route ?? "").localeCompare(b.route ?? "");
    case "digest":
      return (a.digest ?? "").localeCompare(b.digest ?? "");
    case "created":
      return Date.parse(a.created_at) - Date.parse(b.created_at);
    case "userAgent":
      return (a.user_agent ?? "").localeCompare(b.user_agent ?? "");
  }
}

function Th({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th className="px-3 py-2 font-medium">
      <button
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {label}
        <span className="text-[10px]">{active ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}
