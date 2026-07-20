// Pure push-reminder layer (COMPETITION.md F5): VAPID key precedence and the
// per-subscription payload builder. No DB, no web-push runtime.

import { describe, expect, it, vi } from "vitest";

// "server-only" has no runtime module under Vitest; stub it so importing
// lib/server/push-keys.ts (-> supabase-keys -> "server-only") resolves.
vi.mock("server-only", () => ({}));

import { resolveVapidValue } from "../lib/server/push-keys";
import { buildReminderPayload } from "../lib/push/reminder";

describe("resolveVapidValue", () => {
  it("prefers a non-empty DB value over the env fallback", () => {
    expect(resolveVapidValue("db-key", "env-key")).toBe("db-key");
  });
  it("falls back to env when the DB value is empty/whitespace/missing", () => {
    expect(resolveVapidValue("", "env-key")).toBe("env-key");
    expect(resolveVapidValue("   ", "env-key")).toBe("env-key");
    expect(resolveVapidValue(undefined, "env-key")).toBe("env-key");
    expect(resolveVapidValue(null, "env-key")).toBe("env-key");
  });
  it("is null when neither is set", () => {
    expect(resolveVapidValue(undefined, undefined)).toBeNull();
    expect(resolveVapidValue("", "")).toBeNull();
  });
});

describe("buildReminderPayload", () => {
  it("includes both event lines when both are wanted and due", () => {
    const p = buildReminderPayload("en", ["Coca-Cola"], ["MSCI World"], true, true);
    expect(p).not.toBeNull();
    expect(p!.body).toContain("Coca-Cola");
    expect(p!.body).toContain("MSCI World");
    expect(p!.url).toBe("/dividends"); // dividend present -> dividend dashboard
  });

  it("omits an event the subscription did not opt into", () => {
    const p = buildReminderPayload("en", ["Coca-Cola"], ["MSCI World"], false, true);
    expect(p!.body).not.toContain("Coca-Cola");
    expect(p!.body).toContain("MSCI World");
    expect(p!.url).toBe("/"); // savings-only -> dashboard
  });

  it("returns null when nothing the subscription wants is due", () => {
    expect(buildReminderPayload("en", [], ["MSCI World"], true, false)).toBeNull();
    expect(buildReminderPayload("en", ["Coca-Cola"], [], false, true)).toBeNull();
    expect(buildReminderPayload("en", [], [], true, true)).toBeNull();
  });

  it("caps a long name list with an 'and N more' suffix", () => {
    const names = ["A", "B", "C", "D", "E"];
    const p = buildReminderPayload("en", names, [], true, false);
    expect(p!.body).toContain("A, B, C");
    expect(p!.body).toContain("2 more");
    // only the first three names are listed before the "and N more" suffix
    expect(p!.body).toMatch(/A, B, C and 2 more/);
  });

  it("localizes the title (de)", () => {
    const p = buildReminderPayload("de", ["Coca-Cola"], [], true, false);
    expect(p!.title).toBe("FinTrack Erinnerung");
  });
});
