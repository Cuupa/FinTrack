"use client";

// Admin usage: which features people actually use, and the numbers you need to
// run the thing (registered users, active users, sign-ups, errors, shares,
// imports).
//
// The measurement is an aggregate over stored data, never an event stream --
// see app/api/admin/usage/route.ts. Adoption ("how many users have at least
// one") is the honest headline; volume ("how many rows") is context, since one
// power user with 4,000 transactions is not adoption.
//
// A failed load gets its own state with the route's own message and a retry:
// leaving it on the skeleton would look like it is still loading forever.

import { useEffect, useState } from "react";
import { adminAuthToken, adminGet } from "@/lib/admin/client";
import { Button, Card, Stat } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";

interface UsageRow {
  feature: string;
  users: number;
  records: number;
}

interface UsageResponse {
  features: UsageRow[];
  users: { total: number | null; activeLast30d: number | null; newLast30d: number | null };
  health: {
    errors24h: number | null;
    errors7d: number | null;
    shares30d: number | null;
    imports30d: number | null;
  };
}

type SortKey = "feature" | "users" | "records";

export default function AdminUsagePage() {
  const { t } = useI18n();
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "users", dir: -1 });

  // Bumped by the retry button to re-run the effect below. State is only ever
  // set in a promise continuation: Next's set-state-in-effect rule fails the
  // build on a synchronous one, and it cannot see through a called helper.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    adminAuthToken()
      .then((token) => {
        if (!token) throw new Error(t("admin.usage.noSession"));
        return adminGet<UsageResponse>("/api/admin/usage", token);
      })
      .then((res) => {
        if (!active) return;
        setError(null);
        setData(res);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setData(null);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [t, attempt]);

  const num = (v: number | null | undefined) => (v == null ? "—" : formatNumber(v, 0));

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  }

  const rows = data
    ? [...data.features].sort((a, b) => {
        const va = sort.key === "feature" ? a.feature : a[sort.key];
        const vb = sort.key === "feature" ? b.feature : b[sort.key];
        if (va < vb) return -1 * sort.dir;
        if (va > vb) return 1 * sort.dir;
        return 0;
      })
    : [];

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";
  const adoption = (r: UsageRow) =>
    data?.users.total ? Math.min(1, r.users / data.users.total) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.usage.title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("admin.usage.intro")}</p>
      </div>

      {error && (
        <Card>
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <Button className="mt-3" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        </Card>
      )}

      {!error && !data && (
        <Card>
          <Skeleton className="h-24 w-full" />
        </Card>
      )}

      {data && (
        <>
          <Card>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t("admin.usage.users")} value={num(data.users.total)} />
              <Stat label={t("admin.usage.active")} value={num(data.users.activeLast30d)} />
              <Stat label={t("admin.usage.new")} value={num(data.users.newLast30d)} />
              <Stat
                label={t("admin.usage.errors")}
                value={num(data.health.errors24h)}
                sub={`${num(data.health.errors7d)} ${t("admin.usage.errors7d")}`}
                valueClassName={
                  (data.health.errors24h ?? 0) > 0 ? "text-red-600 dark:text-red-400" : ""
                }
              />
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">{t("admin.usage.featuresTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t("admin.usage.featuresIntro")}</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className={thCls} onClick={() => toggleSort("feature")}>
                      {t("admin.usage.colFeature")}
                      {arrow("feature")}
                    </th>
                    <th className={`${thCls} text-right`} onClick={() => toggleSort("users")}>
                      {t("admin.usage.colUsers")}
                      {arrow("users")}
                    </th>
                    <th className={`${thCls} text-right`} onClick={() => toggleSort("records")}>
                      {t("admin.usage.colRecords")}
                      {arrow("records")}
                    </th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.feature}
                      className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 font-medium">
                        {t(`admin.usage.feature.${r.feature}` as MessageKey)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(r.users)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(r.records)}</td>
                      <td className="w-40 px-3 py-2">
                        {/* Share of registered users who have at least one row. */}
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${adoption(r) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">{t("admin.usage.opsTitle")}</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Stat label={t("admin.usage.shares")} value={num(data.health.shares30d)} />
              <Stat label={t("admin.usage.imports")} value={num(data.health.imports30d)} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
