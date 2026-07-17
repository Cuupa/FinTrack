// Provider-agnostic LLM types + the single provider seam. This mirrors the
// DataStore / PriceProvider pattern: all vendor-specific wire knowledge lives
// behind `LlmProvider`, and UI / context / route code call the seam and NEVER
// branch on the provider id. Adding a provider means adding one file under
// providers/ and one registry entry — nothing else changes.
//
// This module is React-free and free of any lib/server import, so it is safe to
// import from both the client (`chat()`, via the /api/llm proxy) and the server
// route (`buildRequest` / `extractDelta` / ...).

export type LlmProviderId = "anthropic" | "openai" | "gemini";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** Vendor model id; providers fall back to `defaultModel` when empty. */
  model: string;
  messages: ChatMessage[];
  /** Optional system preamble (the portfolio context is injected here later). */
  system?: string;
  /** Cap on generated tokens; providers apply a sane default when omitted. */
  maxTokens?: number;
}

export interface LlmModel {
  id: string;
  label: string;
}

/**
 * Machine-readable error codes. Server responses carry only these (never a
 * vendor error body, never the key); the UI localizes them later.
 */
export type LlmErrorCode =
  | "invalidKey" // 401 / 403 — bad or missing API key
  | "rateLimited" // 429
  | "providerDown" // 5xx / upstream unreachable
  | "badRequest" // 400 — malformed request (unknown model, bad body, ...)
  | "network"; // transport failure before any response

/** A concrete vendor HTTP request the server proxy forwards verbatim. */
export interface VendorRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A cancelable async iterator of text deltas. `chat()` returns one; calling
 * `cancel()` aborts the in-flight proxy request (drives the future stop button).
 */
export interface StreamHandle extends AsyncIterable<string> {
  cancel(): void;
}

/**
 * The provider seam — the single place that knows one vendor's wire format.
 *
 * The server route composes `buildRequest` / `buildPingRequest` / `extractDelta`
 * / `extractPingText` to talk to the vendor and normalize its stream. `chat()`
 * is the client entry point: it goes through the `/api/llm` proxy, so no vendor
 * origin is ever contacted from the browser (CSP stays 'self' + supabase).
 */
export interface LlmProvider {
  id: LlmProviderId;
  /** Human label for the provider select (not localized — it is a brand name). */
  label: string;
  /** Curated suggestion list; users may still type any model id. */
  models: LlmModel[];
  defaultModel: string;

  /** Neutral chat request + key -> a streaming vendor HTTP request. */
  buildRequest(request: ChatRequest, key: string): VendorRequest;

  /** A minimal 1-token, non-streamed request for the "test connection" ping. */
  buildPingRequest(key: string, model?: string): VendorRequest;

  /**
   * Extract text from ONE parsed SSE `data:` payload, or null when the event
   * carries no text (unknown / irrelevant event types are ignored). Called by
   * the shared SSE reader (lib/llm/sse.ts), which owns chunk-boundary handling.
   */
  extractDelta(data: unknown): string | null;

  /** Extract the assistant text from a non-streamed ping response body. */
  extractPingText(body: unknown): string;

  /**
   * Client-only: stream a reply through the /api/llm proxy. Uniform across
   * providers — the proxy normalizes every vendor to one delta stream, so this
   * never needs to branch on the provider id.
   */
  chat(request: ChatRequest, key: string): StreamHandle;
}

/**
 * Map a vendor HTTP status to a machine-readable code. HTTP semantics are the
 * same across vendors, so this lives once here rather than on the seam.
 */
export function classifyStatus(status: number): LlmErrorCode {
  if (status === 401 || status === 403) return "invalidKey";
  if (status === 429) return "rateLimited";
  if (status === 400) return "badRequest";
  return "providerDown"; // 5xx and anything else unexpected
}
