// A database that lags its migrations must narrow the app, not kill it.
// Round 27 made a missing TABLE survivable; a missing COLUMN was still fatal,
// because `assets.front_load` (migration 0116) sits in a CORE select and took
// the depot down with it.
import { describe, it, expect } from "vitest";
import { isMissingColumnError, selectTolerant } from "@/lib/store/supabase-store";

describe("isMissingColumnError", () => {
  it("recognises Postgres undefined_column and PostgREST's schema-cache miss", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
    expect(
      isMissingColumnError({
        message: "Could not find the 'front_load' column of 'assets' in the schema cache",
      }),
    ).toBe(true);
    expect(isMissingColumnError({ message: "column assets.front_load does not exist" })).toBe(true);
  });

  it("does not mistake a missing table or a permission error for a missing column", () => {
    // PGRST205 is the missing-table case `optional()` already handles; treating
    // it as a column problem would retry the identical query for nothing.
    expect(isMissingColumnError({ code: "PGRST205", message: "relation does not exist" })).toBe(
      false,
    );
    expect(isMissingColumnError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});

describe("selectTolerant", () => {
  const base = ["id", "name"];
  const added = ["front_load"];

  /** Stands in for PostgREST: knows which columns the database actually has. */
  const db = (present: string[]) => {
    const seen: string[] = [];
    const run = async (columns: string) => {
      seen.push(columns);
      const missing = columns.split(", ").filter((c) => !present.includes(c));
      if (missing.length > 0) {
        return {
          data: null,
          error: { code: "42703", message: `column ${missing[0]} does not exist` },
        };
      }
      return { data: [{ id: "a", name: "Depot" }], error: null };
    };
    return { run, seen };
  };

  it("asks for every column and stops there when the database has them", async () => {
    const { run, seen } = db(["id", "name", "front_load"]);
    const res = await selectTolerant<{ id: string }[]>(run, base, added);

    expect(res.error).toBeNull();
    expect(res.missingColumns).toEqual([]);
    expect(seen).toEqual(["id, name, front_load"]);
  });

  it("retries without the new columns and reports which ones it dropped", async () => {
    const { run, seen } = db(["id", "name"]);
    const res = await selectTolerant<{ id: string }[]>(run, base, added);

    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ id: "a", name: "Depot" }]);
    expect(res.missingColumns).toEqual(["front_load"]);
    expect(seen).toEqual(["id, name, front_load", "id, name"]);
  });

  it("names no columns when the retry failed too", async () => {
    // The caller's own error path owns this, and naming a column would send the
    // user after the wrong migration.
    const run = async () => ({
      data: null,
      error: { code: "42703", message: "column front_load does not exist" },
    });
    const res = await selectTolerant<unknown[]>(run, base, added);

    expect(res.error).not.toBeNull();
    expect(res.missingColumns).toEqual([]);
  });

  it("does not retry an error that is not about a column", async () => {
    const seen: string[] = [];
    const run = async (columns: string) => {
      seen.push(columns);
      return { data: null, error: { code: "PGRST205", message: "relation does not exist" } };
    };
    const res = await selectTolerant<unknown[]>(run, base, added);

    expect(seen).toHaveLength(1);
    expect(res.error?.code).toBe("PGRST205");
  });
});
