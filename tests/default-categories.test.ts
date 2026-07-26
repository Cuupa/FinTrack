import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, missingDefaults } from "@/lib/finance/default-categories";
import type { MessageKey } from "@/lib/i18n/dictionaries";

// Identity translator: the key doubles as the name, which keeps the test
// independent of the copy in any one locale.
const t = (key: MessageKey) => String(key);

describe("missingDefaults", () => {
  it("returns the whole starter set for an empty category list", () => {
    expect(missingDefaults([], t)).toHaveLength(DEFAULT_CATEGORIES.length);
  });

  it("is idempotent: applying twice adds nothing the second time", () => {
    const first = missingDefaults([], t);
    expect(missingDefaults(first, t)).toEqual([]);
  });

  it("returns only what is missing, so a deleted category comes back alone", () => {
    const all = missingDefaults([], t);
    const withoutRent = all.filter((c) => c.name !== "cat.home.rent");
    expect(missingDefaults(withoutRent, t)).toEqual([
      { groupName: "cat.group.home", name: "cat.home.rent" },
    ]);
  });

  it("leaves the user's own categories alone", () => {
    const mine = [{ groupName: "Boat", name: "Mooring" }];
    const result = missingDefaults(mine, t);
    expect(result).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(result).not.toContainEqual({ groupName: "Boat", name: "Mooring" });
  });

  it("matches on the group and name pair, not the name alone", () => {
    // Same name under a different group is a different category.
    const existing = [{ groupName: "Something else", name: "cat.home.rent" }];
    expect(missingDefaults(existing, t)).toContainEqual({
      groupName: "cat.group.home",
      name: "cat.home.rent",
    });
  });

  it("declares no duplicate pair in the starter set itself", () => {
    const pairs = DEFAULT_CATEGORIES.map((c) => `${c.groupKey} ${c.nameKey}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
