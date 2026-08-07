import { describe, expect, it } from "vitest";
import { en, de } from "../lib/i18n/dictionaries";

// The es dictionary has been pinned against en since it was added; de never
// was, so five `vpw` withdrawal keys silently fell back to ENGLISH inside the
// German strategy table. Every locale that ships gets the same guard.

type MessageKey = keyof typeof en;

function placeholders(value: string): Set<string> {
  const matches = value.match(/\{(\w+)\}/g) ?? [];
  return new Set(matches);
}

describe("de dictionary", () => {
  const enKeys = Object.keys(en) as MessageKey[];
  const deKeys = Object.keys(de) as MessageKey[];

  it("has every key from en", () => {
    const missing = enKeys.filter((key) => !(key in de));
    expect(missing).toEqual([]);
  });

  it("has no keys beyond en", () => {
    const extra = deKeys.filter((key) => !(key in en));
    expect(extra).toEqual([]);
  });

  it("keeps the same {placeholder} set as en for every key", () => {
    const mismatches: string[] = [];
    for (const key of enKeys) {
      const deValue = de[key];
      if (deValue === undefined) continue; // covered by the "has every key" test
      const enPh = placeholders(en[key]);
      const dePh = placeholders(deValue);
      const same = enPh.size === dePh.size && [...enPh].every((p) => dePh.has(p));
      if (!same) {
        mismatches.push(`${key}: en=${[...enPh].join(",")} de=${[...dePh].join(",")}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
