import { describe, expect, it } from "vitest";
import {
  allowanceAllocation,
  allowanceAfterChange,
  AllowanceExceededError,
} from "@/lib/finance/tax";

describe("allowanceAllocation", () => {
  it("sums registered per-broker allowances against the cap", () => {
    const a = allowanceAllocation(1000, [400, 300, null, undefined]);
    expect(a.distributed).toBe(700);
    expect(a.available).toBe(1000);
    expect(a.over).toBe(0);
    expect(a.ok).toBe(true);
  });

  it("flags a distribution above the Sparerpauschbetrag", () => {
    const a = allowanceAllocation(1000, [600, 600]);
    expect(a.distributed).toBe(1200);
    expect(a.over).toBe(200);
    expect(a.ok).toBe(false);
  });

  it("treats exactly the cap (and a cent of float slack) as ok", () => {
    expect(allowanceAllocation(1000, [1000]).ok).toBe(true);
    expect(allowanceAllocation(1000, [999.995]).ok).toBe(true);
    expect(allowanceAllocation(1000, [1000.02]).ok).toBe(false);
  });
});

describe("allowanceAfterChange", () => {
  const others = [400, 300];

  it("accepts a change that still fits the cap", () => {
    expect(allowanceAfterChange(1000, others, 300).ok).toBe(true);
  });

  it("rejects a change that overflows the cap", () => {
    const a = allowanceAfterChange(1000, others, 400);
    expect(a.distributed).toBe(1100);
    expect(a.ok).toBe(false);
  });

  it("clearing a broker's allowance (null) never overflows", () => {
    expect(allowanceAfterChange(1000, others, null).ok).toBe(true);
  });
});

describe("AllowanceExceededError", () => {
  it("carries the figures and is matchable by instance", () => {
    const err = new AllowanceExceededError(1200, 1000);
    expect(err).toBeInstanceOf(AllowanceExceededError);
    expect(err.name).toBe("AllowanceExceededError");
    expect(err.distributed).toBe(1200);
    expect(err.available).toBe(1000);
  });
});
