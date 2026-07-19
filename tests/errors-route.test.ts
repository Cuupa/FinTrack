// POST /api/errors (app/api/errors/route.ts) level validation/defaulting:
// the kind allowlist already existed, this adds the analogous level
// allowlist introduced alongside error_logs.level (migration 0069). Follows
// tests/retention.test.ts's convention of stubbing "server-only" so the
// route imports cleanly under Vitest, plus a minimal hand-rolled
// `.from().select().eq().maybeSingle()` / `.insert()` chain stub (no real
// @supabase/supabase-js involved) so the kind/level validation branches --
// which sit after the feature-flag check -- are reachable without an
// x-forwarded-for header (rateLimit fails open with no IP, so it never
// touches the fake client) and without pulling in a full supabase-js mock.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Typed with an explicit payload param (rather than `vi.fn(async () => ...)`)
// purely so `insertMock.mock.calls[0][0]` below type-checks as the inserted
// row; the assertions read it via `.mock.calls`, not the parameter itself.
// Base implementation always succeeds; individual tests override it with
// `mockImplementationOnce`/`mockImplementation` to exercise the retry path.
const insertMock = vi.fn(async (payload: Record<string, unknown>) => {
  void payload;
  return { error: null as { message: string; code?: string } | null };
});

beforeEach(() => {
  insertMock.mockReset();
  insertMock.mockImplementation(async () => ({ error: null }));
});

const supabaseSecretMock = vi.fn(() => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        // Missing feature_flags row => enabled, matching the app-wide
        // "missing row counts as enabled" convention.
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
    insert: insertMock,
  }),
}));

vi.mock("@/lib/server/supabase-keys", () => ({
  supabaseSecret: supabaseSecretMock,
}));

const { POST } = await import("../app/api/errors/route");

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/errors level handling", () => {
  it("defaults to level 'error' when level is omitted", async () => {
    const res = await post({ kind: "boundary", message: "boom" });
    expect(res.status).toBe(204);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ kind: "boundary", level: "error" });
  });

  it("stores an explicit valid level", async () => {
    const res = await post({ kind: "window", message: "hi", level: "warn" });
    expect(res.status).toBe(204);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ level: "warn" });
  });

  it.each(["debug", "info", "warn", "error", "fatal"])(
    "accepts every allowlisted level: %s",
    async (level) => {
      const res = await post({ kind: "boundary", level });
      expect(res.status).toBe(204);
      expect(insertMock.mock.calls[0][0]).toMatchObject({ level });
    },
  );

  it("rejects an invalid level with 400", async () => {
    const res = await post({ kind: "boundary", level: "critical" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid level");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("still rejects an invalid kind with 400", async () => {
    const res = await post({ kind: "nope", level: "error" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid kind");
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/errors lagging-migration (pre-0069) fallback", () => {
  it("retries the insert once without level when the first insert fails, and still succeeds", async () => {
    insertMock.mockImplementationOnce(async () => ({
      error: { message: 'column "level" of relation "error_logs" does not exist', code: "42703" },
    }));
    const res = await post({ kind: "boundary", level: "warn", message: "boom" });
    expect(res.status).toBe(204);
    expect(insertMock).toHaveBeenCalledTimes(2);
    // First attempt carries level (and fails, per the mocked lagging DB).
    expect(insertMock.mock.calls[0][0]).toMatchObject({ level: "warn", kind: "boundary" });
    // Retry drops the level column entirely rather than sending it as null/
    // undefined, so a pre-0069 DB (no `level` column at all) still accepts it.
    expect(insertMock.mock.calls[1][0]).not.toHaveProperty("level");
    expect(insertMock.mock.calls[1][0]).toMatchObject({ kind: "boundary", message: "boom" });
  });

  it("still returns 204 (never a 500) when both the primary insert and the fallback retry fail", async () => {
    insertMock.mockImplementation(async () => ({ error: { message: "db unavailable" } }));
    const res = await post({ kind: "boundary", level: "error", message: "boom" });
    expect(res.status).toBe(204);
    expect(insertMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the first insert succeeds", async () => {
    const res = await post({ kind: "boundary", level: "info", message: "fine" });
    expect(res.status).toBe(204);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
