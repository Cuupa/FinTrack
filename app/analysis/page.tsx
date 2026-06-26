"use client";

import { AllocationView } from "@/components/allocation/allocation-view";

export default function AnalysisPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analysis</h1>
        <p className="text-sm text-zinc-500">
          How your portfolio is distributed across investments, classes,
          currencies, regions and risk.
        </p>
      </div>
      <AllocationView />
    </div>
  );
}
