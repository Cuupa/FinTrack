// Shared LlmErrorCode -> localized message-key mapping. Extracted from the
// settings "AI assistant" tab (P1 core) so the chat panel (P2) can localize
// LlmChatError the same way without duplicating the switch — both surfaces
// show the same wording for "invalid key" / "rate limited" / etc.

import type { LlmErrorCode } from "./types";
import type { MessageKey } from "../i18n/dictionaries";

export const LLM_ERROR_KEYS: Record<LlmErrorCode, MessageKey> = {
  invalidKey: "settings.ai.error.invalidKey",
  rateLimited: "settings.ai.error.rateLimited",
  providerDown: "settings.ai.error.providerDown",
  badRequest: "settings.ai.error.badRequest",
  network: "settings.ai.error.network",
};

export function isLlmErrorCode(value: unknown): value is LlmErrorCode {
  return typeof value === "string" && value in LLM_ERROR_KEYS;
}

/** Localization key for an LlmErrorCode, falling back to the network message
 *  for anything unrecognized (mirrors the settings tab's test-connection
 *  fallback). */
export function llmErrorMessageKey(code: unknown): MessageKey {
  return isLlmErrorCode(code) ? LLM_ERROR_KEYS[code] : "settings.ai.error.network";
}
