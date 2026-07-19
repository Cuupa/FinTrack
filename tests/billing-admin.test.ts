// Pure validation/redaction helpers behind POST /api/admin/billing
// (lib/server/billing-admin.ts). No other app/api/admin/** route unit-tests
// its Supabase-dependent branches (see tests/require-admin.test.ts), so this
// covers the testable surface: body validation, empty-string-means-null
// normalization, and the set/cleared audit redaction.

import { describe, expect, it, vi } from "vitest";

// "server-only" has no runtime module under plain Vitest; stub it so
// importing lib/server/billing-admin.ts resolves, same stub as
// tests/require-admin.test.ts / tests/billing-stripe.test.ts.
vi.mock("server-only", () => ({}));

const { parseBillingConfigBody, parseBillingKeysBody, redactKeysForAudit } = await import(
  "../lib/server/billing-admin"
);

describe("parseBillingConfigBody", () => {
  it("accepts a fully populated body", () => {
    expect(
      parseBillingConfigBody({ priceMonthly: "price_a", priceYearly: "price_b", enabled: true }),
    ).toEqual({ priceMonthly: "price_a", priceYearly: "price_b", enabled: true });
  });

  it("accepts explicit nulls for both price ids", () => {
    expect(
      parseBillingConfigBody({ priceMonthly: null, priceYearly: null, enabled: false }),
    ).toEqual({ priceMonthly: null, priceYearly: null, enabled: false });
  });

  it("trims strings and normalizes empty (post-trim) strings to null", () => {
    expect(
      parseBillingConfigBody({ priceMonthly: "  price_a  ", priceYearly: "   ", enabled: true }),
    ).toEqual({ priceMonthly: "price_a", priceYearly: null, enabled: true });
  });

  it("rejects a non-string, non-null price id", () => {
    expect(
      parseBillingConfigBody({ priceMonthly: 123, priceYearly: null, enabled: true }),
    ).toBeNull();
  });

  it("rejects a non-boolean enabled", () => {
    expect(
      parseBillingConfigBody({ priceMonthly: null, priceYearly: null, enabled: "true" }),
    ).toBeNull();
  });

  it("rejects a missing enabled field", () => {
    expect(parseBillingConfigBody({ priceMonthly: null, priceYearly: null })).toBeNull();
  });
});

describe("parseBillingKeysBody", () => {
  it("returns an empty object when neither field is present (caller rejects this)", () => {
    expect(parseBillingKeysBody({})).toEqual({});
  });

  it("carries only the fields present on the body", () => {
    expect(parseBillingKeysBody({ secretKey: "sk_live_x" })).toEqual({ secretKey: "sk_live_x" });
    expect(parseBillingKeysBody({ webhookSecret: "whsec_x" })).toEqual({
      webhookSecret: "whsec_x",
    });
  });

  it("trims and normalizes an empty string to null (clears the field)", () => {
    expect(parseBillingKeysBody({ secretKey: "   " })).toEqual({ secretKey: null });
  });

  it("passes an explicit null through as null (clears the field)", () => {
    expect(parseBillingKeysBody({ secretKey: null, webhookSecret: "whsec_x" })).toEqual({
      secretKey: null,
      webhookSecret: "whsec_x",
    });
  });

  it("rejects a non-string, non-null present field", () => {
    expect(parseBillingKeysBody({ secretKey: 42 })).toBeNull();
  });

  it("never includes an omitted field in the result", () => {
    const result = parseBillingKeysBody({ secretKey: "sk_live_x" });
    expect(result).not.toBeNull();
    expect("webhookSecret" in (result ?? {})).toBe(false);
  });
});

describe("redactKeysForAudit", () => {
  it("marks a non-null value as set", () => {
    expect(redactKeysForAudit({ secretKey: "sk_live_x" })).toEqual({ secretKey: "set" });
  });

  it("marks a null value as cleared", () => {
    expect(redactKeysForAudit({ secretKey: null })).toEqual({ secretKey: "cleared" });
  });

  it("never leaks the actual secret value into the result", () => {
    const redacted = redactKeysForAudit({ secretKey: "sk_live_super_secret" });
    expect(JSON.stringify(redacted)).not.toContain("sk_live_super_secret");
  });

  it("only includes touched fields", () => {
    expect(redactKeysForAudit({ webhookSecret: "whsec_x" })).toEqual({ webhookSecret: "set" });
  });

  it("handles both fields touched at once", () => {
    expect(redactKeysForAudit({ secretKey: null, webhookSecret: "whsec_x" })).toEqual({
      secretKey: "cleared",
      webhookSecret: "set",
    });
  });
});
