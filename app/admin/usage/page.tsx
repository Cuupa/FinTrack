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
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";

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
  const sort = useSort<SortKey>("users", "desc");

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

  const rows = data ? sort.apply(data.features, (r, key) => r[key]) : [];

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
            <Table className="mt-4">
              <Thead>
                <Th sort={sort.sort} sortKey="feature" onSort={sort.toggle}>
                  {t("admin.usage.colFeature")}
                </Th>
                <Th align="right" sort={sort.sort} sortKey="users" onSort={sort.toggle}>
                  {t("admin.usage.colUsers")}
                </Th>
                <Th align="right" sort={sort.sort} sortKey="records" onSort={sort.toggle}>
                  {t("admin.usage.colRecords")}
                </Th>
                <Th />
              </Thead>
              <Tbody>
                {rows.map((r) => (
                  <Tr key={r.feature}>
                    <Td className="font-medium">
                      {t(`admin.usage.feature.${r.feature}` as MessageKey)}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {num(r.users)}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {num(r.records)}
                    </Td>
                    <Td className="w-40">
                      {/* Share of registered users who have at least one row. */}
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${adoption(r) * 100}%` }}
                        />
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
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
