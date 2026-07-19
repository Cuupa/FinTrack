// Settings subscription card view-state derivation (lib/billing/subscription-view.ts).
// MONETIZATION.md section 3 "Settings UI": Free shows nothing extra, Pro
// shows the next renewal date unless the user cancelled, in which case it
// shows the "ends on" date instead.

import { describe, expect, it } from "vitest";
import { subscriptionCardState, type SubscriptionRow } from "../lib/billing/subscription-view";
import type { PlanGrant } from "../lib/billing/plan";

const NOW = "2026-07-19T00:00:00.000Z";

const ROW: SubscriptionRow = {
  status: "active",
  plan: "pro",
  priceId: "price_123",
  currentPeriodEnd: "2026-08-19T00:00:00.000Z",
  cancelAtPeriodEnd: false,
};

const STALE_ROW: SubscriptionRow = {
  status: "canceled",
  plan: "pro",
  priceId: "price_123",
  currentPeriodEnd: "2026-06-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
};

describe("subscriptionCardState", () => {
  it("free plan with no row shows free", () => {
    expect(subscriptionCardState("free", null)).toEqual({ kind: "free" });
  });

  it("free plan with a stale row still shows free (plan is authoritative)", () => {
    // e.g. a past_due row past its grace window: resolvePlan already
    // downgraded to "free", the card must not show Pro from the raw row.
    expect(subscriptionCardState("free", ROW)).toEqual({ kind: "free" });
  });

  it("pro plan with no row shows free (defensive: should not happen)", () => {
    expect(subscriptionCardState("pro", null)).toEqual({ kind: "free" });
  });

  it("pro plan, not cancelled, shows the renewal date", () => {
    expect(subscriptionCardState("pro", ROW)).toEqual({
      kind: "renewing",
      date: "2026-08-19T00:00:00.000Z",
    });
  });

  it("pro plan, cancel_at_period_end, shows the ends-on date instead", () => {
    const cancelled: SubscriptionRow = { ...ROW, cancelAtPeriodEnd: true };
    expect(subscriptionCardState("pro", cancelled)).toEqual({
      kind: "ending",
      date: "2026-08-19T00:00:00.000Z",
    });
  });

  describe("granted (gratitude premium, no Stripe subscription)", () => {
    it("pro plan, no subscription row, infinite grant shows granted with no date", () => {
      const grants: PlanGrant[] = [{ plan: "pro", expiresAt: null }];
      expect(subscriptionCardState("pro", null, grants, NOW)).toEqual({
        kind: "granted",
        date: null,
      });
    });

    it("pro plan, no subscription row, dated grant shows granted with its expiry", () => {
      const grants: PlanGrant[] = [{ plan: "pro", expiresAt: "2026-09-01T00:00:00.000Z" }];
      expect(subscriptionCardState("pro", null, grants, NOW)).toEqual({
        kind: "granted",
        date: "2026-09-01T00:00:00.000Z",
      });
    });

    it("pro plan, a stale (non-pro-resolving) subscription row, active grant shows granted", () => {
      const grants: PlanGrant[] = [{ plan: "pro", expiresAt: null }];
      expect(subscriptionCardState("pro", STALE_ROW, grants, NOW)).toEqual({
        kind: "granted",
        date: null,
      });
    });

    it("an active subscription wins over a grant (shows renewing, not granted)", () => {
      const grants: PlanGrant[] = [{ plan: "pro", expiresAt: null }];
      expect(subscriptionCardState("pro", ROW, grants, NOW)).toEqual({
        kind: "renewing",
        date: "2026-08-19T00:00:00.000Z",
      });
    });

    it("picks the infinite grant over a dated one", () => {
      const grants: PlanGrant[] = [
        { plan: "pro", expiresAt: "2026-09-01T00:00:00.000Z" },
        { plan: "pro", expiresAt: null },
      ];
      expect(subscriptionCardState("pro", null, grants, NOW)).toEqual({
        kind: "granted",
        date: null,
      });
    });

    it("among dated grants, picks the furthest expiry", () => {
      const grants: PlanGrant[] = [
        { plan: "pro", expiresAt: "2026-09-01T00:00:00.000Z" },
        { plan: "pro", expiresAt: "2027-01-01T00:00:00.000Z" },
      ];
      expect(subscriptionCardState("pro", null, grants, NOW)).toEqual({
        kind: "granted",
        date: "2027-01-01T00:00:00.000Z",
      });
    });

    it("an expired grant does not produce a granted state", () => {
      const grants: PlanGrant[] = [{ plan: "pro", expiresAt: "2026-01-01T00:00:00.000Z" }];
      expect(subscriptionCardState("pro", null, grants, NOW)).toEqual({ kind: "free" });
    });
  });
});
