// Client-side localStorage persistence for the "browser-only" LLM config
// scope. Registered users can choose to keep their BYO API key in this
// browser instead of their account (lib/llm/llm-context.tsx); Guest Mode's
// blob already behaves like browser storage and never touches this module
// directly. Same versioned-schema precedent as the legacy `fintrack-tags` key
// (lib/tags/tags-context.tsx `migrate()`): a `version` field lets a future
// shape change be detected and treated as absent rather than misread,
// instead of silently corrupting.
//
// This is the storage module the original P1 design (commit e62a824) shipped
// as lib/llm/config-storage.ts, then removed in c9c0821 when the config
// moved onto the DataStore seam for every user. It's back as a deliberate,
// opt-in scope choice, not a reversal of that decision - the `fintrack-llm`
// key is now first-class browser-scope storage, not a migration source.
//
// Pure localStorage module, no React, mirroring lib/history/history-cache.ts
// / lib/site-config-cache.ts (storage injectable so tests can pass an
// in-memory Storage stub).

import type { LlmConfig } from "../types";
import type { LlmProviderId } from "./types";

const STORAGE_KEY = "fintrack-llm";
const VERSION = 1;

interface PersistShape extends LlmConfig {
  version: 1;
}

export interface BrowserLlmConfigOptions {
  /** Storage to use; defaults to window.localStorage. */
  storage?: Storage;
}

const PROVIDER_IDS: readonly LlmProviderId[] = ["anthropic", "openai", "gemini"];

function isProviderId(value: unknown): value is LlmProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the browser-scope LLM config. Returns null when there is nothing
 * stored, the payload is malformed, or its `version` doesn't match the
 * current schema (a future shape change bumps VERSION; old data is then
 * treated as absent rather than misread).
 */
export function loadBrowserLlmConfig(opts?: BrowserLlmConfigOptions): LlmConfig | null {
  const storage = resolveStorage(opts?.storage);
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistShape> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== VERSION) return null;
    if (!isProviderId(parsed.provider)) return null;
    if (typeof parsed.model !== "string" || !parsed.model) return null;
    if (typeof parsed.key !== "string" || !parsed.key) return null;
    return { provider: parsed.provider, model: parsed.model, key: parsed.key };
  } catch {
    return null;
  }
}

/**
 * Persist the browser-scope LLM config. Best effort - a full localStorage
 * (quota error) or a JSON failure just skips the write silently, same as the
 * read path.
 */
export function saveBrowserLlmConfig(config: LlmConfig, opts?: BrowserLlmConfigOptions): void {
  const storage = resolveStorage(opts?.storage);
  if (!storage) return;
  try {
    const payload: PersistShape = { version: VERSION, ...config };
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // best effort
  }
}

/** Remove the browser-scope config entirely ("Remove key", switching to
 *  account scope, sign-out). */
export function clearBrowserLlmConfig(opts?: BrowserLlmConfigOptions): void {
  const storage = resolveStorage(opts?.storage);
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // best effort
  }
}
