"use client";

// Structured placeholder for the dashboard's initial load, mirroring
// NetWorthHero + AssetTable closely enough that swapping in real data causes
// no layout jump (for the common case of a portfolio that already has
// holdings — the scenario an initial-load skeleton actually matters for).

import { Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/i18n-context";

function StatSkeleton({ withSub = false }: { withSub?: boolean }) {
  return (
    <div>
      <div className="flex min-h-[1.25rem] items-start md:min-h-[1.75rem]">
        <SkeletonText className="h-3 w-16 md:h-3.5 md:w-20" />
      </div>
      <SkeletonText className="mt-0.5 h-4 w-20 md:mt-1 md:h-6 md:w-24" />
      {withSub && <SkeletonText className="mt-0.5 h-3 w-14" />}
    </div>
  );
}

function RiskStatSkeleton() {
  return (
    <div>
      <div className="flex min-h-[2rem] items-start">
        <SkeletonText className="h-3 w-24" />
      </div>
      <SkeletonText className="mt-0.5 h-4 w-14" />
    </div>
  );
}

function TableRowSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-zinc-100 px-4 py-3 last:border-0 dark:border-zinc-800/60">
      <div className="min-w-0 flex-1 space-y-1.5">
        <SkeletonText className="h-4 w-40" />
        <SkeletonText className="h-3 w-24" />
      </div>
      <SkeletonText className="h-4 w-16 shrink-0" />
      <SkeletonText className="hidden h-4 w-16 shrink-0 sm:block" />
      <SkeletonText className="h-4 w-20 shrink-0" />
      <SkeletonText className="hidden h-4 w-16 shrink-0 md:block" />
      <SkeletonText className="hidden h-4 w-12 shrink-0 lg:block" />
    </div>
  );
}

export function DashboardSkeleton() {
  const { t } = useI18n();
  return (
    <div role="status" aria-busy="true" aria-label={t("common.loading")}>
      {/* Hero: KPI row + chart controls + chart + risk-stats row. */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 md:gap-x-8 md:gap-y-3 lg:grid-cols-6">
            {/* "Change" and "Unrealized" also show a sub-line (% figure) in
                the real hero — matching that keeps the grid row's height (and
                so the whole card's height) the same before/after data loads. */}
            {Array.from({ length: 6 }).map((_, i) => (
              <StatSkeleton key={i} withSub={i === 1 || i === 2} />
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 md:mt-4 md:gap-3">
          <Skeleton className="h-8 w-56 rounded-lg" />
          <div className="ml-auto flex flex-wrap gap-2 md:gap-3">
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-32 rounded-lg" />
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 md:mt-3">
          <Skeleton className="h-5 w-20 rounded" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>

        <div className="mt-3 md:mt-4">
          <Skeleton className="h-[320px] w-full rounded-lg" />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-zinc-200 pt-4 sm:grid-cols-3 lg:grid-cols-5 dark:border-zinc-800">
          {Array.from({ length: 5 }).map((_, i) => (
            <RiskStatSkeleton key={i} />
          ))}
        </div>
      </Card>

      {/* Holdings table: header bar + a handful of rows. */}
      <div className="mt-4 rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <Skeleton className="h-6 w-32 rounded" />
          <Skeleton className="h-8 w-28 rounded-lg" />
          <Skeleton className="ml-auto h-8 w-full max-w-xs rounded-lg" />
        </div>
        {/* Column-header row (the real table's <thead>). */}
        <div className="flex items-center gap-4 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <SkeletonText className="h-3 w-16" />
          <SkeletonText className="ml-auto h-3 w-16 shrink-0" />
          <SkeletonText className="hidden h-3 w-16 shrink-0 sm:block" />
          <SkeletonText className="h-3 w-16 shrink-0" />
          <SkeletonText className="hidden h-3 w-16 shrink-0 md:block" />
          <SkeletonText className="hidden h-3 w-16 shrink-0 lg:block" />
        </div>
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
