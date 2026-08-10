import { describe, expect, it } from "vitest";
import { accountSelectionKey, pruneSelection } from "@/lib/accounts/selection-storage";

describe("accountSelectionKey", () => {
  it("namespaces per user, with a guest fallback", () => {
    expect(accountSelectionKey("u1")).toBe("fintrack-selected-accounts:u1");
    expect(accountSelectionKey(null)).toBe("fintrack-selected-accounts:guest");
  });
});

describe("pruneSelection", () => {
  const existing = ["a", "b", "c"];

  it("drops ids that no longer exist, keeping stored order", () => {
    expect(pruneSelection(["c", "gone", "a"], existing)).toEqual(["c", "a"]);
  });

  it("returns empty for non-array or non-string entries", () => {
    expect(pruneSelection(null, existing)).toEqual([]);
    expect(pruneSelection("a", existing)).toEqual([]);
    expect(pruneSelection([1, "a", null], existing)).toEqual(["a"]);
  });

  it("returns empty when nothing matches (e.g. a different user's ids)", () => {
    expect(pruneSelection(["x", "y"], existing)).toEqual([]);
  });
});
