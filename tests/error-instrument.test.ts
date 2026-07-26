// lib/errors/instrument.ts: the global fetch + console capture that makes
// handled failures (a 404 nobody rethrows, a console.error) reach
// /admin/errors. reportError is mocked so the assertions are about WHAT would
// be logged, not about the network.
//
// The two properties that matter beyond "it reports at all":
//   - the wrapped fetch is transparent (same response out, same error
//     rethrown, no report about the reporter's own endpoint), and
//   - the logged URL carries no query string, because a PostgREST filter
//     spells out `user_id=eq.<uuid>` and /datenschutz promises the error log
//     holds no user id.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportErrorMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/errors/report", () => ({ reportError: reportErrorMock }));

import { installConsoleReporter, installFetchReporter } from "../lib/errors/instrument";

function lastReport(): Record<string, unknown> {
  const calls = reportErrorMock.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe("installFetchReporter", () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    reportErrorMock.mockReset();
    const noop = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", noop);
    vi.stubGlobal("window", {
      fetch: noop,
      location: { origin: "https://app.test", pathname: "/admin/billing" },
    });
  });

  afterEach(() => {
    uninstall();
    vi.unstubAllGlobals();
  });

  function install(responder: () => Promise<Response>) {
    window.fetch = responder as unknown as typeof fetch;
    uninstall = installFetchReporter();
  }

  it("reports a 500 as an error and returns the response untouched", async () => {
    install(async () => new Response("nope", { status: 500, statusText: "Internal Server Error" }));
    const res = await window.fetch("/api/admin/billing/grants");

    expect(res.status).toBe(500);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    const report = lastReport();
    expect(report.kind).toBe("fetch");
    expect(report.level).toBe("error");
    expect(report.message).toContain("/api/admin/billing/grants");
    expect(report.message).toContain("500");
    expect(report.route).toBe("/admin/billing");
  });

  it("reports a 4xx as a warning, so routine 401s stay filterable", async () => {
    install(async () => new Response(null, { status: 404 }));
    await window.fetch("https://db.test/rest/v1/plan_grants");

    expect(lastReport().level).toBe("warn");
  });

  it("drops the query string, which carries the user id", async () => {
    install(async () => new Response(null, { status: 404 }));
    await window.fetch(
      "https://db.test/rest/v1/plan_grants?select=plan&user_id=eq.8d3ab2e2-9760-475f-912a-fef92d19ac32",
    );

    const message = lastReport().message as string;
    expect(message).toContain("https://db.test/rest/v1/plan_grants");
    expect(message).not.toContain("8d3ab2e2");
    expect(message).not.toContain("?");
  });

  it("reports a network failure and rethrows it unchanged", async () => {
    const boom = new TypeError("NetworkError when attempting to fetch resource");
    install(async () => {
      throw boom;
    });

    await expect(window.fetch("/api/quotes")).rejects.toBe(boom);
    expect(lastReport().level).toBe("error");
    expect(lastReport().message).toContain("NetworkError");
  });

  it("never reports a failure of the reporting endpoint itself", async () => {
    install(async () => new Response(null, { status: 500 }));
    await window.fetch("/api/errors", { method: "POST" });

    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("stays silent on a successful response", async () => {
    install(async () => new Response("{}", { status: 200 }));
    await window.fetch("/api/quotes");

    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("does not patch twice and restores the original on uninstall", async () => {
    install(async () => new Response(null, { status: 200 }));
    const patched = window.fetch;
    const second = installFetchReporter();
    expect(window.fetch).toBe(patched);

    second();
    uninstall();
    expect(window.fetch).not.toBe(patched);
  });
});

describe("installConsoleReporter", () => {
  let uninstall: () => void = () => {};
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    reportErrorMock.mockReset();
    originalError = console.error;
    originalWarn = console.warn;
    console.error = vi.fn();
    console.warn = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/dashboard" } });
    uninstall = installConsoleReporter();
  });

  afterEach(() => {
    uninstall();
    console.error = originalError;
    console.warn = originalWarn;
    vi.unstubAllGlobals();
  });

  it("mirrors console.error into the log and still writes to the console", () => {
    console.error("render failed", new Error("boom"));

    const report = lastReport();
    expect(report.kind).toBe("console");
    expect(report.level).toBe("error");
    expect(report.message).toBe("render failed boom");
    expect(report.stack).toContain("boom");
    expect(report.route).toBe("/dashboard");
  });

  it("mirrors console.warn at warn level", () => {
    console.warn("deprecated thing");
    expect(lastReport().level).toBe("warn");
  });

  it("serializes non-string arguments instead of dropping them", () => {
    console.error({ status: 500 });
    expect(lastReport().message).toBe('{"status":500}');
  });

  it("restores the original console methods on uninstall", () => {
    const patched = console.error;
    uninstall();
    expect(console.error).not.toBe(patched);
  });
});
