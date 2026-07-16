import { describe, expect, it } from "vitest";
import { en, es } from "../lib/i18n/dictionaries";

type MessageKey = keyof typeof en;

function placeholders(value: string): Set<string> {
  const matches = value.match(/\{(\w+)\}/g) ?? [];
  return new Set(matches);
}

describe("es dictionary", () => {
  const enKeys = Object.keys(en) as MessageKey[];
  const esKeys = Object.keys(es) as MessageKey[];

  it("has every key from en", () => {
    const missing = enKeys.filter((key) => !(key in es));
    expect(missing).toEqual([]);
  });

  it("has no keys beyond en", () => {
    const extra = esKeys.filter((key) => !(key in en));
    expect(extra).toEqual([]);
  });

  it("keeps the same {placeholder} set as en for every key", () => {
    const mismatches: string[] = [];
    for (const key of enKeys) {
      const enValue = en[key];
      const esValue = es[key];
      if (esValue === undefined) continue; // covered by the "has every key" test
      const enPh = placeholders(enValue);
      const esPh = placeholders(esValue);
      const same =
        enPh.size === esPh.size && [...enPh].every((p) => esPh.has(p));
      if (!same) {
        mismatches.push(
          `${key}: en=${[...enPh].join(",")} es=${[...esPh].join(",")}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});
