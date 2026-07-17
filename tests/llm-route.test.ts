// /api/llm proxy behavior with a fully mocked upstream fetch: streams through
// (vendor SSE -> uniform normalized deltas), the 256 KB payload cap rejects,
// vendor 401/429/5xx map to machine-readable codes, the key never leaks, and
// ping mode round-trips ok/error.
//
// The route imports lib/server/rate-limit (-> supabase-keys -> "server-only").
// "server-only" has no runtime module under plain Vitest, so it's stubbed; with
// Supabase env unset, rateLimit fails open (returns true), so nothing is gated.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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

const { POST } = await import("../app/api/llm/route");

/** A streaming Response whose body emits `chunks` as encoded UTF-8. */
function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

/** Read a normalized proxy stream body and return the concatenated deltas. */
async function collectDeltas(res: Response): Promise<{ deltas: string; sawDone: boolean }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  let deltas = "";
  let sawDone = false;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice("data:".length).trim();
    if (payload === "[DONE]") {
      sawDone = true;
      continue;
    }
    const obj = JSON.parse(payload) as { delta?: string };
    if (typeof obj.delta === "string") deltas += obj.delta;
  }
  return { deltas, sawDone };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/llm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/llm — streaming passthrough (normalized)", () => {
  it("forwards to the vendor and re-emits uniform delta + [DONE] frames", async () => {
    stubUnconfigured();
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      streamResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      post({
        provider: "anthropic",
        model: "claude-sonnet-5",
        key: "sk-secret-key",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const { deltas, sawDone } = await collectDeltas(res);
    expect(deltas).toBe("Hello");
    expect(sawDone).toBe(true);

    // Forwarded to Anthropic with the key in the x-api-key header, streaming on.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-secret-key");
    expect(JSON.parse(init.body as string).stream).toBe(true);
  });
});

describe("POST /api/llm — guards", () => {
  it("rejects a body over the 256 KB cap with 413 (before parsing/fetch)", async () => {
    stubUnconfigured();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const huge = "x".repeat(256 * 1024 + 10);
    const res = await POST(
      post({ provider: "anthropic", key: "k", messages: [{ role: "user", content: huge }] }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("payloadTooLarge");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 badRequest for an unknown provider", async () => {
    stubUnconfigured();
    vi.stubGlobal("fetch", vi.fn());
    const res = await POST(post({ provider: "nope", key: "k", messages: [{ role: "user", content: "x" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("badRequest");
  });

  it("401 invalidKey when the key is missing", async () => {
    stubUnconfigured();
    vi.stubGlobal("fetch", vi.fn());
    const res = await POST(post({ provider: "openai", messages: [{ role: "user", content: "x" }] }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalidKey");
  });

  it("400 badRequest for malformed messages", async () => {
    stubUnconfigured();
    vi.stubGlobal("fetch", vi.fn());
    const res = await POST(post({ provider: "openai", key: "k", messages: [{ role: "system", content: "x" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("badRequest");
  });
});

describe("POST /api/llm — vendor error mapping", () => {
  const cases: Array<[number, string, number]> = [
    [401, "invalidKey", 401],
    [403, "invalidKey", 401],
    [429, "rateLimited", 429],
    [500, "providerDown", 502],
    [503, "providerDown", 502],
  ];

  for (const [vendorStatus, code, ourStatus] of cases) {
    it(`vendor ${vendorStatus} -> {error:"${code}"} (${ourStatus}), key not leaked`, async () => {
      stubUnconfigured();
      // Vendor error body echoes content + would-be key — must never appear in our response.
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "bad key sk-secret-key" } }), {
          status: vendorStatus,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const res = await POST(
        post({ provider: "openai", key: "sk-secret-key", messages: [{ role: "user", content: "x" }] }),
      );
      expect(res.status).toBe(ourStatus);
      const raw = await res.text();
      expect(JSON.parse(raw).error).toBe(code);
      expect(raw).not.toContain("sk-secret-key");
    });
  }

  it("maps a network failure (fetch throws) to network 502", async () => {
    stubUnconfigured();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const res = await POST(post({ provider: "gemini", key: "k", messages: [{ role: "user", content: "x" }] }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("network");
  });
});

describe("POST /api/llm — ping mode", () => {
  it("returns { ok: true } on a successful non-streamed ping", async () => {
    stubUnconfigured();
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(post({ provider: "anthropic", key: "k", ping: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // Ping request is non-streamed.
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).stream).toBe(false);
  });

  it("maps a ping vendor 401 to invalidKey", async () => {
    stubUnconfigured();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const res = await POST(post({ provider: "anthropic", key: "bad", ping: true }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalidKey");
  });
});
