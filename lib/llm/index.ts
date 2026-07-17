// LLM provider registry — the single lookup point mapping a provider id to its
// adapter. UI, context, and route code resolve a provider here and then call
// the seam; they never branch on the id themselves.

import type { LlmProvider, LlmProviderId } from "./types";
import { anthropic } from "./providers/anthropic";
import { openai } from "./providers/openai";
import { gemini } from "./providers/gemini";

export const providers: Record<LlmProviderId, LlmProvider> = {
  anthropic,
  openai,
  gemini,
};

/** Ordered list for provider select menus. */
export const providerList: LlmProvider[] = [anthropic, openai, gemini];

/** Resolve a provider by id, or undefined for an unknown id. */
export function getProvider(id: string): LlmProvider | undefined {
  return (providers as Record<string, LlmProvider>)[id];
}

export * from "./types";
