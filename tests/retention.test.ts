// app/api/cron/sync/retention/route.ts response-shape branches that are
// cheaply testable without mocking @supabase/supabase-js: the 401 (missing/
// wrong bearer token) and 500 ("secret key not configured") guards both run
// before any supabase-js query is built. The actual delete calls (cutoff
// dates, table names, counts) would need a full mock of the `.from().delete()
// .lt()` chain; no route in this codebase mocks that chain today (see
// tests/require-admin.test.ts, which only unit-tests the shared lib
// function, and tests/error-report.test.ts, which mocks at the apiFetch
// boundary instead), following that convention rather than introducing
// bespoke supabase-js chain mocks for this route alone.

import { afterEach, describe, expect, it, vi } from "vitest";

// "server-only" is a Next.js build-time guard with no real runtime module on
// disk outside Next's own bundler; stub it so importing the route (which
// imports lib/server/supabase-keys.ts, which imports "server-only") doesn't
// fail module resolution under plain Vitest. Same stub as require-admin.test.ts.
vi.mock("server-only", () => ({}));

const { POST } = await import("../app/api/cron/sync/retention/route");

const SUPABASE_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

function stubUnconfigured() {
  for (const name of SUPABASE_ENV_VARS) vi.stubEnv(name, "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/cron/sync/retention", () => {
  it("returns 401 when CRON_SECRET is set and the request carries no bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t");
    const req = new Request("http://localhost/api/cron/sync/retention", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when the bearer token does not match CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t");
    const req = new Request("http://localhost/api/cron/sync/retention", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("proceeds without a bearer token when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    stubUnconfigured();
    const req = new Request("http://localhost/api/cron/sync/retention", { method: "POST" });
    const res = await POST(req);
    // Past the auth gate, hits the "secret key not configured" branch since
    // Supabase env is stubbed empty.
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("secret key not configured");
  });

  it("returns 500 with 'secret key not configured' when Supabase env is unset", async () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t");
    stubUnconfigured();
    const req = new Request("http://localhost/api/cron/sync/retention", {
      method: "POST",
      headers: { authorization: "Bearer s3cr3t" },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("secret key not configured");
  });
});
