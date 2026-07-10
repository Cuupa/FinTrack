import { describe, expect, it } from "vitest";
import { migrate } from "../lib/tags/tags-context";

describe("migrate", () => {
  it("upgrades a legacy single-string map into the default group", () => {
    const result = migrate({ asset1: "gamble" });
    expect(result.version).toBe(2);
    expect(result.groups).toEqual([{ id: "default", name: "Tags" }]);
    expect(result.assignments).toEqual({ asset1: { default: ["gamble"] } });
  });

  it("upgrades a legacy Record<assetId,string[]> map, keeping all values", () => {
    const result = migrate({ asset1: ["gamble", "core"], asset2: ["core"] });
    expect(result.groups).toEqual([{ id: "default", name: "Tags" }]);
    expect(result.assignments).toEqual({
      asset1: { default: ["gamble", "core"] },
      asset2: { default: ["core"] },
    });
  });

  it("normalizes null/garbage input to version 2 with no groups and no assignments", () => {
    expect(migrate(null)).toEqual({ version: 2, groups: [], assignments: {} });
    expect(migrate(42)).toEqual({ version: 2, groups: [], assignments: {} });
    expect(migrate("garbage")).toEqual({ version: 2, groups: [], assignments: {} });
  });

  it("passes through a v2 shape, dropping malformed groups and assignment entries", () => {
    const raw = {
      version: 2,
      groups: [
        { id: "g1", name: "Strategie" },
        { id: "bad" }, // missing name, dropped
        "nope", // not an object, dropped
        { id: "g2", name: "Risiko" },
      ],
      assignments: {
        asset1: { g1: ["gamble"], g2: "not-an-array", g3: ["ignored-group-still-kept"] },
        asset2: "not-an-object", // dropped entirely
        asset3: { g1: [1, "core", null] }, // non-strings filtered
      },
    };
    const result = migrate(raw);
    expect(result).toEqual({
      version: 2,
      groups: [
        { id: "g1", name: "Strategie" },
        { id: "g2", name: "Risiko" },
      ],
      assignments: {
        asset1: { g1: ["gamble"], g3: ["ignored-group-still-kept"] },
        asset3: { g1: ["core"] },
      },
    });
  });

  it("leaves an empty legacy map with no default group", () => {
    expect(migrate({})).toEqual({ version: 2, groups: [], assignments: {} });
  });
});
