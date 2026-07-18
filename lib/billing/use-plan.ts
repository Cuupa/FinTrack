"use client";

// Phase-1 seam (MONETIZATION.md section 3): no `subscriptions` table exists
// yet, so this always resolves "free" — guests and no-Supabase deploys are
// always 'free' by definition anyway. Once Phase 1 ships a `BillingProvider`
// that loads the signed-in user's subscription row, this hook becomes a thin
// `useContext` read that feeds the row into `resolvePlan` (lib/billing/plan.ts).
// Feature-flag resolution (lib/flags/resolve.ts) already consumes this hook,
// so wiring real billing state through it needs no call-site changes.

import type { Plan } from "./plan";

export function usePlan(): Plan {
  return "free";
}
