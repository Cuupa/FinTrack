// requireAdmin (lib/server/require-admin.ts) response-shape branches that
// are cheaply testable without mocking @supabase/supabase-js. The
// "not configured" branch depends on Supabase env vars that this sandbox
// never sets but that a real deploy (the user's machine, Vercel) always
// does via .env.local / dashboard secrets: lib/server/supabase-keys.ts reads
// `process.env` fresh on every call rather than caching at module load, so
// there's no import-time snapshot to fight — `vi.stubEnv` for the duration
// of a test, `vi.unstubAllEnvs()` after, makes the "unconfigured" branch
// deterministic in both places instead of only passing where the ambient
// environment happens to be bare. The authenticated/forbidden/success
// branches need a live (or heavily mocked) Supabase client and aren't
// covered here: no other app/api/** route in this codebase unit-tests its
// Supabase-dependent branches either (see app/api/account/delete/route.ts,
// app/api/share/route.ts), so this follows the existing convention rather
// than introducing bespoke supabase-js mocks.

import { afterEach, describe, expect, it, vi } from "vitest";

// "server-only" is a Next.js build-time guard with no real runtime module on
// disk outside Next's own bundler (it isn't a plain npm package Vitest can
// resolve). Stub it so importing lib/server/require-admin.ts under plain
// Vitest doesn't fail module resolution. supabase-keys.ts imports it the
// same way, which is exactly why no existing test imports that module
// either.
vi.mock("server-only", () => ({}));

const { audit, requireAdmin } = await import("../lib/server/require-admin");

// Every var lib/server/supabase-keys.ts reads (new key names + legacy
// fallbacks). Stubbing all of them to "" (falsy, same as unset) forces
// supabasePublishable()/supabaseSecret() to resolve to null regardless of
// what's actually present in this process's environment.
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

describe("requireAdmin", () => {
  it("returns 401 when no Authorization header is present", async () => {
    // No env stubbing here on purpose: requireAdmin checks for a bearer
    // token before it ever reads Supabase config, so this branch must 401
    // the same way whether or not Supabase happens to be configured in the
    // running environment.
    const req = new Request("http://localhost/api/admin/flags");
    const result = await requireAdmin(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(401);
      const body = await result.res.json();
      expect(body.error).toBe("unauthorized");
    }
  });

  it("returns 401 when the Authorization header has an empty bearer token", async () => {
    // Same reasoning as above: an empty token short-circuits before any
    // config check, independent of ambient env.
    const req = new Request("http://localhost/api/admin/flags", {
      headers: { authorization: "Bearer " },
    });
    const result = await requireAdmin(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.res.status).toBe(401);
  });

  it("returns 503 when Supabase is not configured (Guest-only deploy)", async () => {
    stubUnconfigured();
    const req = new Request("http://localhost/api/admin/flags", {
      headers: { authorization: "Bearer some-token" },
    });
    const result = await requireAdmin(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(503);
      const body = await result.res.json();
      expect(body.error).toBe("admin not configured");
    }
  });
});

describe("audit", () => {
  it("resolves without throwing when Supabase is not configured", async () => {
    stubUnconfigured();
    await expect(
      audit({ userId: "u1", email: "a@b.com" }, "flag.set_global", "xray", null, { enabled: true }),
    ).resolves.toBeUndefined();
  });
});
