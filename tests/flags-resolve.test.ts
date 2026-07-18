// Pure per-flag resolution (lib/flags/resolve.ts), extracted from
// lib/flags/flags-context.tsx specifically so the resolution order
// (MONETIZATION.md section 4) is unit-testable without mounting the
// provider tree / mocking the supabase-js fetch chain.

import { describe, expect, it } from "vitest";
import { resolveFeature } from "../lib/flags/resolve";

const FREE_ON = { enabled: true, requiredPlan: "free" };
const PRO_ON = { enabled: true, requiredPlan: "pro" };
const OFF = { enabled: false, requiredPlan: "free" };
const PRO_OFF = { enabled: false, requiredPlan: "pro" };

describe("resolveFeature", () => {
  it("no Supabase: on and unlocked, regardless of global/override/plan", () => {
    expect(resolveFeature(PRO_ON, undefined, "free", false, false)).toEqual({
      enabled: true,
      locked: false,
    });
    expect(resolveFeature(OFF, false, "pro", false, true)).toEqual({
      enabled: true,
      locked: false,
    });
  });

  it("globals not loaded yet: off and unlocked, no enabled-flash", () => {
    expect(resolveFeature(undefined, undefined, "free", true, false)).toEqual({
      enabled: false,
      locked: false,
    });
    // Order matters: "not loaded" (step 2) is checked before "override"
    // (step 3), so even a present override can't shortcut the no-flash rule.
    expect(resolveFeature(PRO_ON, true, "free", true, false)).toEqual({
      enabled: false,
      locked: false,
    });
  });

  it("override true unlocks a Pro flag for a free-plan user", () => {
    expect(resolveFeature(PRO_ON, true, "free", true, true)).toEqual({
      enabled: true,
      locked: false,
    });
  });

  it("override false disables an otherwise-enabled flag", () => {
    expect(resolveFeature(FREE_ON, false, "free", true, true)).toEqual({
      enabled: false,
      locked: false,
    });
  });

  it("override wins outright even over a kill-switched global", () => {
    expect(resolveFeature(OFF, true, "free", true, true)).toEqual({
      enabled: true,
      locked: false,
    });
  });

  it("kill switch hides the feature even for a Pro-plan user", () => {
    expect(resolveFeature(PRO_OFF, undefined, "pro", true, true)).toEqual({
      enabled: false,
      locked: false,
    });
  });

  it("missing global row: off and unlocked", () => {
    expect(resolveFeature(undefined, undefined, "free", true, true)).toEqual({
      enabled: false,
      locked: false,
    });
  });

  it("pro-required + free plan: enabled but locked (visible teaser)", () => {
    expect(resolveFeature(PRO_ON, undefined, "free", true, true)).toEqual({
      enabled: true,
      locked: true,
    });
  });

  it("pro-required + pro plan: enabled and unlocked", () => {
    expect(resolveFeature(PRO_ON, undefined, "pro", true, true)).toEqual({
      enabled: true,
      locked: false,
    });
  });

  it("unknown/missing requiredPlan value counts as free (predates the migration)", () => {
    expect(
      resolveFeature(
        { enabled: true, requiredPlan: "" },
        undefined,
        "free",
        true,
        true,
      ),
    ).toEqual({ enabled: true, locked: false });
    expect(
      resolveFeature(
        { enabled: true, requiredPlan: "enterprise" },
        undefined,
        "free",
        true,
        true,
      ),
    ).toEqual({ enabled: true, locked: false });
  });

  it("free-required flag: enabled and unlocked for both plans", () => {
    expect(resolveFeature(FREE_ON, undefined, "free", true, true)).toEqual({
      enabled: true,
      locked: false,
    });
    expect(resolveFeature(FREE_ON, undefined, "pro", true, true)).toEqual({
      enabled: true,
      locked: false,
    });
  });
});
