"use client";

// Structured placeholder for the dividends page's initial load, mirroring
// DividendsView's stat row + income chart + by-holding/forecast cards so real
// data replacing it causes no layout jump. Without this, the page briefly
// shows the "no dividends yet" empty state while the portfolio is still
// loading (data.assets is empty until then).

import { Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/i18n-context";

// Exported so DividendsView can reuse them for the finer-grained loading
// state while events are being fetched (data.assets already loaded, just
// waiting on /api/dividends) — see components/dividends/dividends-view.tsx.
export function StatCardSkeleton() {
  return (
    <Card>
      <SkeletonText className="h-3 w-24" />
      <SkeletonText className="mt-1.5 h-6 w-20" />
    </Card>
  );
}

export function ListRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <SkeletonText className="h-4 w-32" />
      <SkeletonText className="h-4 w-16" />
    </div>
  );
}

export function DividendsSkeleton() {
  const { t } = useI18n();
  return (
    <div role="status" aria-busy="true" aria-label={t("common.loading")} className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SkeletonText className="h-5 w-32" />
          <Skeleton className="h-7 w-40 rounded-lg" />
        </div>
        <div className="mt-3">
          <Skeleton className="h-[260px] w-full rounded-lg" />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SkeletonText className="h-5 w-32" />
          <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {Array.from({ length: 5 }).map((_, i) => (
              <ListRowSkeleton key={i} />
            ))}
          </div>
        </Card>
        <Card>
          <SkeletonText className="h-5 w-24" />
          <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {Array.from({ length: 5 }).map((_, i) => (
              <ListRowSkeleton key={i} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
