// requireAdmin (lib/server/require-admin.ts) response-shape branches that
// are cheaply testable without mocking @supabase/supabase-js: the test
// environment has no NEXT_PUBLIC_SUPABASE_URL/keys set (mirrors a Guest-only
// deploy), so supabasePublishable()/supabaseSecret() both resolve to null
// exactly like they would in production without Supabase configured. The
// authenticated/forbidden/success branches need a live (or heavily mocked)
// Supabase client and aren't covered here: no other app/api/** route in
// this codebase unit-tests its Supabase-dependent branches either (see
// app/api/account/delete/route.ts, app/api/share/route.ts), so this follows
// the existing convention rather than introducing bespoke supabase-js mocks.

import { describe, expect, it, vi } from "vitest";

// "server-only" is a Next.js build-time guard with no real runtime module on
// disk outside Next's own bundler (it isn't a plain npm package Vitest can
// resolve). Stub it so importing lib/server/require-admin.ts under plain
// Vitest doesn't fail module resolution. supabase-keys.ts imports it the
// same way, which is exactly why no existing test imports that module
// either.
vi.mock("server-only", () => ({}));

const { audit, requireAdmin } = await import("../lib/server/require-admin");

describe("requireAdmin", () => {
  it("returns 401 when no Authorization header is present", async () => {
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
    const req = new Request("http://localhost/api/admin/flags", {
      headers: { authorization: "Bearer " },
    });
    const result = await requireAdmin(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.res.status).toBe(401);
  });

  it("returns 503 when Supabase is not configured (Guest-only deploy)", async () => {
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
    await expect(
      audit({ userId: "u1", email: "a@b.com" }, "flag.set_global", "xray", null, { enabled: true }),
    ).resolves.toBeUndefined();
  });
});
