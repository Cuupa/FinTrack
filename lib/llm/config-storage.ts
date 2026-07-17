// Client-side localStorage persistence for the user's BYO LLM config
// (provider, model, API key). Same versioned-schema precedent as the legacy
// `fintrack-tags` key (lib/tags/tags-context.tsx `migrate()`): a `version`
// field lets a future shape change be detected and treated as absent rather
// than misread, instead of silently corrupting.
//
// Deliberately NOT part of the DataStore seam / DB (LLM_INTEGRATION.md's key
// handling decision): the server must never hold a long-lived third-party
// credential, and guest mode must work identically to registered mode. So
// this stays a pure localStorage module, no React, mirroring the pattern in
// lib/history/history-cache.ts / lib/site-config-cache.ts (storage
// injectable so tests can pass an in-memory Storage stub).

import type { LlmProviderId } from "./types";

const STORAGE_KEY = "fintrack-llm";
const VERSION = 1;

export interface LlmConfig {
  provider: LlmProviderId;
  model: string;
  key: string;
}

interface PersistShape extends LlmConfig {
  version: 1;
}

export interface LlmConfigStorageOptions {
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
 * Read the stored LLM config. Returns null when there is nothing stored, the
 * payload is malformed, or its `version` doesn't match the current schema
 * (a future shape change bumps VERSION; old data is then treated as absent
 * rather than misread).
 */
export function loadLlmConfig(opts?: LlmConfigStorageOptions): LlmConfig | null {
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
 * Persist the LLM config. Best effort - a full localStorage (quota error) or
 * a JSON failure just skips the write silently, same as the read path.
 */
export function saveLlmConfig(config: LlmConfig, opts?: LlmConfigStorageOptions): void {
  const storage = resolveStorage(opts?.storage);
  if (!storage) return;
  try {
    const payload: PersistShape = { version: VERSION, ...config };
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // best effort
  }
}

/** Remove the stored config entirely ("Remove key" button, sign-out). */
export function clearLlmConfig(opts?: LlmConfigStorageOptions): void {
  const storage = resolveStorage(opts?.storage);
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // best effort
  }
}
