// BYO-key LLM streaming proxy.
//
// The browser can't call vendor origins directly (CSP `connect-src` stays
// 'self' + *.supabase.co, matching the "market-data calls are server-side by
// design" rule), so this route forwards the user's key per-request to the
// chosen provider and pipes the reply back.
//
// DESIGN CHOICE — server-side normalization (not raw vendor SSE passthrough).
// The route parses each vendor's SSE via its lib/llm adapter and re-emits ONE
// uniform stream: `data: {"delta":"..."}` frames, an optional
// `data: {"error":"code"}` frame on a mid-stream failure, and a `data: [DONE]`
// sentinel. Rationale: it keeps every vendor's SSE quirk inside lib/llm (the
// route already needs the adapters for the error/ping paths), and it hands the
// browser a single trivial format so the client adapter never branches on the
// provider id — the core seam invariant. Raw passthrough would duplicate three
// vendors' parsers in the client and leak provider knowledge there.
//
// Key handling: the key is read from the request body, used once, and NEVER
// logged, persisted, or echoed. Vendor error bodies are drained and discarded;
// error responses carry only a machine-readable code.

import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { getProvider } from "@/lib/llm";
import { classifyStatus, type ChatMessage, type LlmErrorCode, type LlmProvider } from "@/lib/llm/types";
import { newSseState, pushDeltas } from "@/lib/llm/sse";

export const dynamic = "force-dynamic";

/** Reject request bodies above this size outright (context is compact by design). */
const MAX_PAYLOAD_BYTES = 256 * 1024;

/** Per-IP request budget per minute (fail-open without Supabase, like market-data routes). */
const RATE_LIMIT_PER_MIN = 30;

const ERROR_STATUS: Record<LlmErrorCode, number> = {
  invalidKey: 401,
  rateLimited: 429,
  providerDown: 502,
  badRequest: 400,
  network: 502,
};

function errorResponse(code: LlmErrorCode): Response {
  return Response.json({ error: code }, { status: ERROR_STATUS[code] });
}

interface RequestBody {
  provider?: unknown;
  model?: unknown;
  key?: unknown;
  messages?: unknown;
  system?: unknown;
  ping?: unknown;
}

function normalizeMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    out.push({ role, content });
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await rateLimit("llm", req, RATE_LIMIT_PER_MIN))) return tooManyRequests();

  // Payload cap on the raw body — never parse an oversized request.
  const raw = await req.text();
  if (raw.length > MAX_PAYLOAD_BYTES) {
    return Response.json({ error: "payloadTooLarge" }, { status: 413 });
  }

  let body: RequestBody;
  try {
    body = JSON.parse(raw) as RequestBody;
  } catch {
    return errorResponse("badRequest");
  }

  const provider = getProvider(typeof body.provider === "string" ? body.provider : "");
  if (!provider) return errorResponse("badRequest");

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return errorResponse("invalidKey");

  const model =
    typeof body.model === "string" && body.model ? body.model : provider.defaultModel;

  // Ping mode: minimal non-streamed request for the "test connection" button.
  if (body.ping === true) {
    return handlePing(provider, key, model, req.signal);
  }

  const messages = normalizeMessages(body.messages);
  if (!messages) return errorResponse("badRequest");
  const system = typeof body.system === "string" ? body.system : undefined;

  const vendor = provider.buildRequest({ model, messages, system }, key);

  let upstream: Response;
  try {
    upstream = await fetch(vendor.url, {
      method: "POST",
      headers: vendor.headers,
      body: JSON.stringify(vendor.body),
      // Client disconnect aborts req.signal, which cancels the upstream fetch —
      // this is what makes the future stop button actually stop generation.
      signal: req.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return new Response(null, { status: 499 });
    return errorResponse("network");
  }

  if (!upstream.ok || !upstream.body) {
    await upstream.text().catch(() => ""); // drain + discard the vendor error body
    return errorResponse(classifyStatus(upstream.status));
  }

  return new Response(normalizeStream(upstream.body, provider), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

/** Minimal 1-token non-streamed request; returns { ok: true } or a normalized error. */
async function handlePing(
  provider: LlmProvider,
  key: string,
  model: string,
  signal: AbortSignal,
): Promise<Response> {
  const vendor = provider.buildPingRequest(key, model);
  let res: Response;
  try {
    res = await fetch(vendor.url, {
      method: "POST",
      headers: vendor.headers,
      body: JSON.stringify(vendor.body),
      signal,
    });
  } catch {
    return errorResponse("network");
  }
  if (!res.ok) {
    await res.text().catch(() => "");
    return errorResponse(classifyStatus(res.status));
  }
  await res.text().catch(() => ""); // discard — only ok/error matters here
  return Response.json({ ok: true });
}

/** Parse the vendor SSE and re-emit a uniform normalized delta stream. */
function normalizeStream(
  upstream: ReadableStream<Uint8Array>,
  provider: LlmProvider,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = newSseState();

  const frame = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
  const doneFrame = () => encoder.encode("data: [DONE]\n\n");

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.enqueue(doneFrame());
          controller.close();
          return;
        }
        const deltas = pushDeltas(decoder.decode(value, { stream: true }), state, (d) =>
          provider.extractDelta(d),
        );
        for (const delta of deltas) controller.enqueue(frame({ delta }));
        if (state.done) {
          controller.enqueue(doneFrame());
          controller.close();
          reader.cancel().catch(() => {});
        }
      } catch {
        // Upstream failed mid-stream — surface a normalized error frame, never
        // the raw vendor error (which could echo request content).
        controller.enqueue(frame({ error: "providerDown" }));
        controller.close();
        reader.cancel().catch(() => {});
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}
