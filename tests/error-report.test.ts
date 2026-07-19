// reportError (lib/errors/report.ts): no-op without Supabase, truncation,
// and the module-level throttle/dedupe that caps reports at 5/minute and
// drops an identical kind+message+route repeat within 60s. apiFetch is
// mocked (same pattern as tests/use-dividends.test.ts) so no real network
// call happens and the test controls exactly what was sent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());
const isSupabaseConfiguredMock = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/api", () => ({ apiFetch: apiFetchMock }));
vi.mock("@/lib/supabase/client", () => ({
  get isSupabaseConfigured() {
    return isSupabaseConfiguredMock.value;
  },
}));

import { reportError, truncate, __resetThrottleForTests } from "../lib/errors/report";

function parsedBody(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("truncate", () => {
  it("returns undefined for empty/null/undefined input", () => {
    expect(truncate(undefined, 10)).toBeUndefined();
    expect(truncate(null, 10)).toBeUndefined();
    expect(truncate("", 10)).toBeUndefined();
  });

  it("passes short strings through unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("cuts strings longer than max to exactly max chars", () => {
    expect(truncate("a".repeat(20), 10)).toBe("a".repeat(10));
  });
});

describe("reportError", () => {
  beforeEach(() => {
    isSupabaseConfiguredMock.value = true;
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    __resetThrottleForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no-ops when Supabase is not configured", () => {
    isSupabaseConfiguredMock.value = false;
    reportError({ kind: "boundary", message: "boom" });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("posts to /api/errors with keepalive when configured", () => {
    reportError({ kind: "boundary", message: "boom", stack: "at x()", route: "/foo", digest: "d1" });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/errors");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(parsedBody(apiFetchMock.mock.calls[0])).toEqual({
      kind: "boundary",
      level: "error",
      message: "boom",
      stack: "at x()",
      route: "/foo",
      digest: "d1",
    });
  });

  it("defaults level to 'error' when omitted", () => {
    reportError({ kind: "boundary", message: "boom" });
    const body = parsedBody(apiFetchMock.mock.calls[0]);
    expect(body.level).toBe("error");
  });

  it("includes an explicit level in the body", () => {
    reportError({ kind: "boundary", level: "fatal", message: "boom" });
    const body = parsedBody(apiFetchMock.mock.calls[0]);
    expect(body.level).toBe("fatal");
  });

  it("dedupes by kind+level+message+route, not kind+message+route alone", () => {
    reportError({ kind: "window", level: "warn", message: "same error", route: "/dash" });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    // Same kind/message/route but a different level is a distinct report.
    reportError({ kind: "window", level: "error", message: "same error", route: "/dash" });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it("truncates message to 500 chars and stack to 4000 chars client-side", () => {
    const longMessage = "m".repeat(600);
    const longStack = "s".repeat(5000);
    reportError({ kind: "boundary", message: longMessage, stack: longStack });
    const body = parsedBody(apiFetchMock.mock.calls[0]);
    expect((body.message as string).length).toBe(500);
    expect((body.stack as string).length).toBe(4000);
  });

  it("drops calls beyond the 5-per-minute cap", () => {
    for (let i = 0; i < 5; i++) {
      reportError({ kind: "boundary", message: `err-${i}`, route: `/r${i}` });
    }
    expect(apiFetchMock).toHaveBeenCalledTimes(5);

    // 6th distinct report in the same window is dropped by the cap, not the
    // dedupe (different message/route from every prior call).
    reportError({ kind: "boundary", message: "err-6", route: "/r6" });
    expect(apiFetchMock).toHaveBeenCalledTimes(5);
  });

  it("allows reports again once the throttle window has passed", () => {
    for (let i = 0; i < 5; i++) {
      reportError({ kind: "boundary", message: `err-${i}`, route: `/r${i}` });
    }
    expect(apiFetchMock).toHaveBeenCalledTimes(5);

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    reportError({ kind: "boundary", message: "err-later", route: "/later" });
    expect(apiFetchMock).toHaveBeenCalledTimes(6);
  });

  it("drops an identical kind+message+route repeat within 60s", () => {
    reportError({ kind: "window", message: "same error", route: "/dash" });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    reportError({ kind: "window", message: "same error", route: "/dash" });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not dedupe once the 60s window has passed", () => {
    reportError({ kind: "window", message: "same error", route: "/dash" });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    reportError({ kind: "window", message: "same error", route: "/dash" });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it("never throws even if apiFetch throws synchronously", () => {
    apiFetchMock.mockImplementation(() => {
      throw new Error("network down");
    });
    expect(() => reportError({ kind: "boundary", message: "boom" })).not.toThrow();
  });

  it("never throws when fetch is unavailable", () => {
    const original = globalThis.fetch;
    // @ts-expect-error deliberately removing fetch to exercise the guard
    delete globalThis.fetch;
    expect(() => reportError({ kind: "boundary", message: "boom" })).not.toThrow();
    expect(apiFetchMock).not.toHaveBeenCalled();
    globalThis.fetch = original;
  });
});
