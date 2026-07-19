"use client";

// Thin context read (MONETIZATION.md section 3, Phase 1). `BillingProvider`
// (lib/billing/billing-context.tsx) loads the signed-in user's `subscriptions`
// row and derives the Plan via `resolvePlan` (lib/billing/plan.ts); this hook
// just surfaces it. The context's default value resolves "free" when no
// provider is mounted (e.g. a test rendering a component in isolation), so
// this keeps its exact pre-Phase-1 signature and every existing call site —
// feature-flag resolution (lib/flags/resolve.ts) included — needs no change.

import { useBilling } from "./billing-context";
import type { Plan } from "./plan";

export function usePlan(): Plan {
  return useBilling().plan;
}
