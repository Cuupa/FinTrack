"use client";

// Structured placeholder for the asset-detail page's initial load, mirroring
// AssetDetail's header + chart card + metrics grid + details card so real
// data replacing it causes no layout jump.

import { Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/i18n-context";

function MetricCardSkeleton() {
  return (
    <Card>
      <SkeletonText className="h-3 w-20" />
      <SkeletonText className="mt-1.5 h-6 w-24" />
    </Card>
  );
}

function DetailRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3">
      <SkeletonText className="h-3 w-20" />
      <SkeletonText className="h-3 w-24" />
    </div>
  );
}

export function AssetDetailSkeleton() {
  const { t } = useI18n();
  return (
    <div role="status" aria-busy="true" aria-label={t("common.loading")} className="space-y-6">
      {/* Header: back link, name + identifiers, price line, delete button. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SkeletonText className="h-4 w-28" />
          <SkeletonText className="mt-2 h-8 w-64" />
          <SkeletonText className="mt-2 h-5 w-40" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Price chart card. */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <Skeleton className="h-8 w-56 rounded-lg" />
          <Skeleton className="ml-auto h-8 w-28 rounded-lg" />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-20 rounded" />
        </div>
        <div className="mt-4">
          <Skeleton className="h-[320px] w-full rounded-lg" />
        </div>
        <div className="mt-2 flex flex-wrap gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonText key={i} className="h-3 w-16" />
          ))}
        </div>
      </Card>

      {/* Advanced metrics. */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>

      {/* Details card. */}
      <div className="grid gap-4">
        <Card>
          <SkeletonText className="h-5 w-24" />
          <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <DetailRowSkeleton key={i} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
