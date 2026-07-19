// Pure entitlement derivation (MONETIZATION.md section 3). No React, no
// Supabase — `BillingProvider` (lib/billing/billing-context.tsx) loads the
// signed-in user's `subscriptions` row AND `plan_grants` rows ("gratitude
// premium", migration 0068) and feeds both into `resolvePlan`; every
// consumer (feature flags, limits) reads the result via `usePlan()`
// (lib/billing/use-plan.ts) without knowing this function exists.

export type Plan = "free" | "pro";

export interface SubscriptionState {
  /** Stripe subscription status, verbatim (e.g. "active", "trialing", "past_due", "canceled"). */
  status: string;
  /** ISO datetime of the current billing period's end. */
  currentPeriodEnd: string;
}

/**
 * A manually-granted entitlement ("gratitude premium", e.g. a test/thank-you
 * reward) independent of any Stripe subscription. `plan_grants`
 * (migration 0068), written only by the service role. `expiresAt` null means
 * the grant never expires.
 */
export interface PlanGrant {
  plan: string;
  expiresAt: string | null;
}

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

function hasActiveProGrant(grants: PlanGrant[] | undefined, nowISO: string): boolean {
  if (!grants || grants.length === 0) return false;
  const now = new Date(nowISO).getTime();
  return grants.some((grant) => {
    if (grant.plan !== "pro") return false;
    if (grant.expiresAt == null) return true;
    return now < new Date(grant.expiresAt).getTime();
  });
}

/**
 * plan(user) = 'pro'  if status in ('active', 'trialing')
 *              'pro'  if status = 'past_due' and now < currentPeriodEnd + 7 days   -- grace
 *              'pro'  if an active `plan_grants` row exists (independent of Stripe)
 *              'free' otherwise (including no row, guest, or no Supabase)
 */
export function resolvePlan(
  sub: SubscriptionState | null | undefined,
  nowISO: string,
  grants?: PlanGrant[],
): Plan {
  if (hasActiveProGrant(grants, nowISO)) return "pro";
  if (!sub) return "free";
  if (sub.status === "active" || sub.status === "trialing") return "pro";
  if (sub.status === "past_due") {
    const graceEnd = new Date(sub.currentPeriodEnd).getTime() + GRACE_PERIOD_MS;
    const now = new Date(nowISO).getTime();
    if (now < graceEnd) return "pro";
  }
  return "free";
}
