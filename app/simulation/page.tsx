"use client";

import { MonteCarloPanel } from "@/components/simulation/monte-carlo-panel";

export default function SimulationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Simulation</h1>
        <p className="text-sm text-zinc-500">
          Project your long-term wealth with a Monte Carlo simulation.
        </p>
      </div>
      <MonteCarloPanel />
    </div>
  );
}
