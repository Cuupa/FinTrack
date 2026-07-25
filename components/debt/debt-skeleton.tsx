"use client";

import { Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

export function DebtSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </Card>
      <Card>
        <Skeleton className="h-6 w-40" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}
