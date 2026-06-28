"use client";

import { RebalancingView } from "@/components/rebalancing/rebalancing-view";

export default function RebalancingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rebalancing</h1>
        <p className="text-sm text-zinc-500">
          Compare your current allocation to a target and see the trades needed to
          get there.
        </p>
      </div>
      <RebalancingView />
    </div>
  );
}
