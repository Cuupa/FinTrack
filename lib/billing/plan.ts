// Pure entitlement derivation (MONETIZATION.md section 3). No React, no
// Supabase — `BillingProvider` (lib/billing/billing-context.tsx) loads the
// signed-in user's `subscriptions` row and feeds it through `resolvePlan`;
// every consumer (feature flags, limits) reads the result via `usePlan()`
// (lib/billing/use-plan.ts) without knowing this function exists.

export type Plan = "free" | "pro";

export interface SubscriptionState {
  /** Stripe subscription status, verbatim (e.g. "active", "trialing", "past_due", "canceled"). */
  status: string;
  /** ISO datetime of the current billing period's end. */
  currentPeriodEnd: string;
}

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * plan(user) = 'pro'  if status in ('active', 'trialing')
 *              'pro'  if status = 'past_due' and now < currentPeriodEnd + 7 days   -- grace
 *              'free' otherwise (including no row, guest, or no Supabase)
 */
export function resolvePlan(
  sub: SubscriptionState | null | undefined,
  nowISO: string,
): Plan {
  if (!sub) return "free";
  if (sub.status === "active" || sub.status === "trialing") return "pro";
  if (sub.status === "past_due") {
    const graceEnd = new Date(sub.currentPeriodEnd).getTime() + GRACE_PERIOD_MS;
    const now = new Date(nowISO).getTime();
    if (now < graceEnd) return "pro";
  }
  return "free";
}
