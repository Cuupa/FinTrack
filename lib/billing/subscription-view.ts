// Pure view-state derivation for the settings "Subscription" card
// (MONETIZATION.md section 3 "Settings UI"). Kept side-effect-free and
// React-free so it is directly unit-testable (repo convention: pure parts
// tested, provider/component wiring is not) — the only caller is
// components/settings/subscription-card.tsx via lib/billing/billing-context.tsx.

import { resolvePlan, type Plan, type PlanGrant } from "./plan";

export interface SubscriptionRow {
  /** Stripe subscription status, verbatim. */
  status: string;
  /** Always "pro" today (MONETIZATION.md: one paid tier); kept as text so a
   *  future second tier needs no schema change. */
  plan: string;
  priceId: string | null;
  /** ISO datetime of the current billing period's end. */
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export type SubscriptionCardState =
  | { kind: "free" }
  | { kind: "renewing"; date: string }
  | { kind: "ending"; date: string }
  /** Pro via a `plan_grants` row ("gratitude premium"), not a Stripe
   *  subscription — no Stripe customer exists, so the card must not offer
   *  the billing-portal manage button in this state. `date` is the grant's
   *  expiry, or null for an infinite grant. */
  | { kind: "granted"; date: string | null };

function subscriptionAloneIsPro(subscription: SubscriptionRow | null, nowISO: string): boolean {
  if (!subscription) return false;
  return (
    resolvePlan({ status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd }, nowISO) ===
    "pro"
  );
}

/** The active grant with the furthest coverage: an infinite grant (no
 *  expiry) always wins over a dated one; among dated ones, the furthest
 *  expiry wins. Returns null if no grant is currently active. */
function pickActiveGrant(grants: PlanGrant[] | undefined, nowISO: string): PlanGrant | null {
  if (!grants || grants.length === 0) return null;
  const now = new Date(nowISO).getTime();
  const active = grants.filter(
    (grant) => grant.plan === "pro" && (grant.expiresAt == null || now < new Date(grant.expiresAt).getTime()),
  );
  if (active.length === 0) return null;
  const infinite = active.find((grant) => grant.expiresAt == null);
  if (infinite) return infinite;
  return active.reduce((furthest, grant) =>
    new Date(grant.expiresAt as string).getTime() > new Date(furthest.expiresAt as string).getTime()
      ? grant
      : furthest,
  );
}

/**
 * What the settings card should show, from the already-resolved plan
 * (lib/billing/plan.ts `resolvePlan`), the raw `subscriptions` row, and any
 * `plan_grants` rows ("gratitude premium"). `plan` (not the row's own
 * status) decides Free vs Pro so this stays consistent with feature-flag
 * gating everywhere else — a `past_due` row past its grace window resolves
 * to `plan: "free"` and reads as Free here too, even though the row itself
 * still exists. Within Pro, a subscription that alone resolves to pro wins
 * (`cancelAtPeriodEnd` then picks the "ends on" wording over the next
 * renewal date, MONETIZATION.md lifecycle table); otherwise an active grant
 * explains the Pro plan and the card shows "granted" instead, since a
 * granted-only user has no Stripe customer to manage.
 */
export function subscriptionCardState(
  plan: Plan,
  subscription: SubscriptionRow | null,
  grants?: PlanGrant[],
  nowISO?: string,
): SubscriptionCardState {
  if (plan !== "pro") return { kind: "free" };
  const now = nowISO ?? new Date().toISOString();
  if (subscription && subscriptionAloneIsPro(subscription, now)) {
    return subscription.cancelAtPeriodEnd
      ? { kind: "ending", date: subscription.currentPeriodEnd }
      : { kind: "renewing", date: subscription.currentPeriodEnd };
  }
  const grant = pickActiveGrant(grants, now);
  if (grant) return { kind: "granted", date: grant.expiresAt };
  // Defensive: plan is pro but neither the subscription nor any grant
  // explains it (should not happen — resolvePlan derives plan from exactly
  // these two sources).
  return { kind: "free" };
}
