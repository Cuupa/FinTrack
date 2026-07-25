"use client";

// System page: shows which database migrations have been applied.

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Card, EmptyState, PAGE_STACK, PageHeader, SectionTitle } from "@/components/ui/primitives";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/i18n-context";

interface Migration {
  version: string;
  applied_at: string;
}

type SortKey = "version" | "applied_at";

export default function SystemPage() {
  const [migrations, setMigrations] = useState<Migration[] | null>(null);
  const { t } = useI18n();
  // Newest migration first: the one you just applied is the one you came to check.
  const { sort, toggle, apply } = useSort<SortKey>("applied_at", "desc");

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/migrations")
      .then((r) => (r.ok ? r.json() : { migrations: [] }))
      .then((d: { migrations?: Migration[] }) => {
        if (!cancelled) setMigrations(d.migrations ?? []);
      })
      .catch(() => {
        if (!cancelled) setMigrations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = migrations ? apply(migrations, (m, key) => m[key]) : [];

  return (
    <div className={PAGE_STACK}>
      <PageHeader title={t("system.title")} subtitle={t("system.subtitle")} />

      <Card>
        <SectionTitle>{t("system.migrations")}</SectionTitle>
        {migrations === null ? (
          <div className="mt-3 space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : migrations.length === 0 ? (
          <EmptyState title={t("system.none")} />
        ) : (
          <Table className="mt-3">
            <Thead>
              <Th sort={sort} sortKey="version" onSort={toggle}>
                {t("system.colVersion")}
              </Th>
              <Th align="right" sort={sort} sortKey="applied_at" onSort={toggle}>
                {t("system.colApplied")}
              </Th>
            </Thead>
            <Tbody>
              {rows.map((m) => (
                <Tr key={m.version}>
                  <Td className="font-mono text-xs">{m.version}</Td>
                  <Td align="right" className="tabular-nums text-zinc-500">
                    {m.applied_at ? formatDateTime(m.applied_at) : "—"}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
