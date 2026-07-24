"use client";

import { Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

export function HealthSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
