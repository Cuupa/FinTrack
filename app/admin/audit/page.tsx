"use client";

// Audit trail viewer: public.admin_audit is admin-nonreadable except under
// the is_admin() RLS policy (migration 0050), same idiom as
// app/admin/errors/page.tsx reading error_logs straight from the browser
// client. Read-only: nothing here writes to admin_audit, every admin route
// (flags/site/prices/errors) already records its own row via
// lib/server/require-admin.ts's `audit()` helper.
//
// Newest first, capped at 200 rows per fetch ("load more" appends the next
// 200 via `.range()`); filters (action select, built from the distinct
// actions seen among *loaded* rows, good enough at this volume per the
// task) and a free-text search run client-side over what's already fetched,
// matching admin/errors's filter pattern. old_value/new_value render as a
// compact one-line JSON summary (lib/admin/audit-format.ts) with an expand
// toggle for the full pretty-printed value when it doesn't fit.

import { Fragment, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";
import {
  Table,
  TablePagination,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  usePagination,
} from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatInstant } from "@/lib/format";
import { formatCompactJson, formatFullJson } from "@/lib/admin/audit-format";
import { Button, Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { SelectMenu } from "@/components/ui/select-menu";

interface AuditRow {
  id: string;
  actor_id: string;
  actor_email: string | null;
  action: string;
  target: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

const PAGE_SIZE = 200;
const AUDIT_COLUMNS = "id, actor_id, actor_email, action, target, old_value, new_value, created_at";

export default function AdminAuditPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionFilter, setActionFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("admin_audit")
      .select(AUDIT_COLUMNS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(0, PAGE_SIZE - 1)
      .then(({ data }) => {
        if (!active) return;
        const list = (data ?? []) as AuditRow[];
        setRows(list);
        setHasMore(list.length === PAGE_SIZE);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadMore = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || rows === null) return;
    setLoadingMore(true);
    try {
      const { data } = await supabase
        .from("admin_audit")
        .select(AUDIT_COLUMNS)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(rows.length, rows.length + PAGE_SIZE - 1);
      const list = (data ?? []) as AuditRow[];
      setRows((prev) => [...(prev ?? []), ...list]);
      setHasMore(list.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  };

  const actions = useMemo(() => {
    const set = new Set((rows ?? []).map((r) => r.action));
    return Array.from(set).sort();
  }, [rows]);

  // The fetch already returns newest first; the sort makes that a column the
  // reader can flip, which the four hand-written headers here never were.
  const sort = useSort<"created" | "actor" | "action" | "target">("created", "desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = (rows ?? []).filter((r) => {
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      if (!q) return true;
      return (
        (r.actor_email ?? "").toLowerCase().includes(q) ||
        r.actor_id.toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q) ||
        (r.target ?? "").toLowerCase().includes(q)
      );
    });
    return sort.apply(matching, (r, key) =>
      key === "created"
        ? r.created_at
        : key === "actor"
          ? (r.actor_email ?? r.actor_id)
          : key === "action"
            ? r.action
            : r.target,
    );
  }, [rows, actionFilter, query, sort]);


  // Same 25-row paging as every other table in the app.
  const pager = usePagination(filtered);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.audit.title")}</h1>
        <p className="text-sm text-zinc-500">{t("admin.audit.subtitle")}</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-zinc-500">{t("admin.audit.colAction")}</label>
            <SelectMenu
              value={actionFilter}
              onChange={setActionFilter}
              className="mt-1 w-48"
              ariaLabel={t("admin.audit.colAction")}
              options={[
                { value: "all", label: t("admin.audit.actionAll") },
                ...actions.map((a) => ({ value: a, label: a })),
              ]}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs text-zinc-500">{t("admin.audit.filterLabel")}</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("admin.audit.filterPlaceholder")}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </div>
        </div>

        <p className="mt-3 text-xs text-zinc-500">
          {t("admin.audit.count", { count: String(filtered.length), total: String(rows?.length ?? 0) })}
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
              {rows.length === 0 ? t("admin.audit.empty") : t("admin.audit.noMatch")}
            </p>
          ) : (
            <>
            <Table>
              <Thead>
                <Th sort={sort.sort} sortKey="created" onSort={sort.toggle}>
                  {t("admin.audit.colCreated")}
                </Th>
                <Th sort={sort.sort} sortKey="actor" onSort={sort.toggle}>
                  {t("admin.audit.colActor")}
                </Th>
                <Th sort={sort.sort} sortKey="action" onSort={sort.toggle}>
                  {t("admin.audit.colAction")}
                </Th>
                <Th sort={sort.sort} sortKey="target" onSort={sort.toggle}>
                  {t("admin.audit.colTarget")}
                </Th>
                {/* The two value columns hold JSON blobs; ordering by a
                    pretty-printed object is not a question anyone asks. */}
                <Th>{t("admin.audit.colOld")}</Th>
                <Th>{t("admin.audit.colNew")}</Th>
              </Thead>
              <Tbody>
                {pager.rows.map((r) => {
                  const isExpanded = expanded === r.id;
                  const oldCompact = formatCompactJson(r.old_value);
                  const newCompact = formatCompactJson(r.new_value);
                  const hasMoreDetail = oldCompact.truncated || newCompact.truncated;
                  return (
                    <Fragment key={r.id}>
                      <Tr selected={isExpanded}>
                        <Td className="align-top text-xs whitespace-nowrap text-zinc-500">
                          {formatInstant(r.created_at)}
                        </Td>
                        <Td className="max-w-[10rem] truncate align-top text-xs text-zinc-500">
                          {r.actor_email ?? r.actor_id}
                        </Td>
                        <Td className="align-top font-mono text-xs">{r.action}</Td>
                        <Td className="max-w-[10rem] truncate align-top font-mono text-xs text-zinc-500">
                          {r.target ?? "—"}
                        </Td>
                        <Td className="max-w-[14rem] align-top font-mono text-xs text-zinc-500">
                          <div className="truncate">{oldCompact.text}</div>
                        </Td>
                        <Td className="max-w-[14rem] align-top font-mono text-xs text-zinc-500">
                          <div className="truncate">{newCompact.text}</div>
                          {hasMoreDetail && (
                            <button
                              type="button"
                              onClick={() => setExpanded(isExpanded ? null : r.id)}
                              className="mt-1 text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
                            >
                              {isExpanded ? t("admin.audit.collapse") : t("admin.audit.expand")}
                            </button>
                          )}
                        </Td>
                      </Tr>
                      {isExpanded && (
                        <Tr selected>
                          <Td colSpan={6} className="py-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <div className="text-xs font-medium text-zinc-500">
                                  {t("admin.audit.colOld")}
                                </div>
                                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-100 p-2 font-mono text-[11px] text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                                  {formatFullJson(r.old_value)}
                                </pre>
                              </div>
                              <div>
                                <div className="text-xs font-medium text-zinc-500">
                                  {t("admin.audit.colNew")}
                                </div>
                                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-100 p-2 font-mono text-[11px] text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                                  {formatFullJson(r.new_value)}
                                </pre>
                              </div>
                            </div>
                          </Td>
                        </Tr>
                      )}
                    </Fragment>
                  );
                })}
              </Tbody>
            </Table>
            <TablePagination pager={pager} />
            </>
          )}
        </div>

        {rows !== null && rows.length > 0 && hasMore && (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? t("admin.audit.loadingMore") : t("admin.audit.loadMore")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
