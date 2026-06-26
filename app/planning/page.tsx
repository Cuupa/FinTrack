"use client";

import { MonteCarloPanel } from "@/components/planning/monte-carlo-panel";

export default function PlanningPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Financial planning</h1>
        <p className="text-sm text-zinc-500">
          Project your long-term wealth with a Monte Carlo simulation.
        </p>
      </div>
      <MonteCarloPanel />
    </div>
  );
}
