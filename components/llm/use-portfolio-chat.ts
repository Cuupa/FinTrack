"use client";

// Chat conversation state for the floating chat bubble/panel. Not part of
// lib/llm (which stays React-free) — this is the one place that wires the
// pure provider seam (lib/llm) + pure context builder (lib/llm/context.ts)
// to live portfolio data via hooks.
//
// Conversation state (messages, streaming) lives here, in the component that
// mounts once at the root (components/llm/chat-bubble.tsx), so a conversation
// survives closing and reopening the panel within the session. There is no
// persistence across reloads (P3 in LLM_INTEGRATION.md, deliberately
// deferred) — "New chat" / a full reload both start empty.
//
// The system prompt (the portfolio context JSON) is built ONCE per
// conversation, on the first send — not on every keystroke/render — and
// reused for every follow-up message in that conversation, mirroring how a
// real chat's system prompt is fixed for the session.

import { useCallback, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { lookupInstrument } from "@/lib/catalog/catalog";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useLlmConfig } from "@/lib/llm/llm-context";
import { getProvider } from "@/lib/llm";
import { LlmChatError } from "@/lib/llm/proxy-chat";
import type { StreamHandle } from "@/lib/llm/types";
import { llmErrorMessageKey } from "@/lib/llm/error-messages";
import { buildPortfolioContext, buildSystemPrompt } from "@/lib/llm/context";
import { summarizeAll } from "@/lib/finance/portfolio";
import { byAssetClass, byCountry, byCurrency } from "@/lib/finance/allocation";
import { estimatePortfolioStats, portfolioRiskStats, type StatHolding } from "@/lib/finance/stats";
import { assetPriceKey } from "@/lib/types";
import { today } from "@/lib/finance/dates";
import type { MessageKey } from "@/lib/i18n/dictionaries";

export interface ChatUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface PortfolioChat {
  messages: ChatUiMessage[];
  /** True while a reply is streaming (composer shows Stop instead of Send). */
  streaming: boolean;
  /** True once streaming has started but before the first delta arrived — the
   *  panel shows the typing-dots skeleton instead of an empty bubble. */
  awaitingFirstDelta: boolean;
  /** Localized message key for the last error, or null. Cleared on the next send. */
  errorMessageKey: MessageKey | null;
  /** Brand label of the configured provider (e.g. "Anthropic (Claude)"), for the consent note. */
  providerLabel: string;
  /** Whether a message can be sent right now (configured + not already streaming). */
  canSend: boolean;
  send(text: string): void;
  stop(): void;
  newChat(): void;
}

let idCounter = 0;
function genId(): string {
  idCounter += 1;
  return `llm-msg-${idCounter}`;
}

export function usePortfolioChat(): PortfolioChat {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  // Subscribed only so this hook re-renders once the catalog (dividend
  // yields, country data) finishes loading — lookups themselves go through
  // the module-level lib/catalog/catalog.ts functions, same as allocation.ts.
  useCatalog();
  const { locale } = useI18n();
  const { config } = useLlmConfig();

  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [awaitingFirstDelta, setAwaitingFirstDelta] = useState(false);
  const [errorMessageKey, setErrorMessageKey] = useState<MessageKey | null>(null);

  // Fixed for the lifetime of one conversation; rebuilt (lazily, on next
  // send) after `newChat()` clears it.
  const systemPromptRef = useRef<string | null>(null);
  const streamRef = useRef<StreamHandle | null>(null);

  const provider = config ? getProvider(config.provider) : undefined;

  const buildSystemPromptOnce = useCallback((): string => {
    if (systemPromptRef.current) return systemPromptRef.current;

    const holdings = summarizeAll(data.assets, data.transactions, valuation);
    const statHoldings: StatHolding[] = holdings.map((h) => ({
      asset: h.asset,
      marketValue: h.marketValue,
    }));

    const dividendYields: Record<string, number> = {};
    for (const h of holdings) {
      const key = assetPriceKey(h.asset);
      const inst = lookupInstrument(key);
      if (inst && inst.dividendYield > 0) dividendYields[key] = inst.dividendYield;
    }

    const contextJson = buildPortfolioContext({
      baseCurrency: data.profile.currency,
      today: today(),
      holdings,
      assets: data.assets,
      savingsPlans: data.savingsPlans,
      dividendYields,
      // No-holdings falls back to null here (not a benchmark) — an empty
      // portfolio should read as empty to the assistant, not as "invested
      // like FTSE All-World".
      portfolioStats: estimatePortfolioStats(statHoldings),
      riskStats: portfolioRiskStats(statHoldings),
      allocationByClass: byAssetClass(holdings),
      allocationByCurrency: byCurrency(holdings, data.profile.currency),
      allocationByCountry: byCountry(holdings),
    });

    const prompt = buildSystemPrompt(contextJson, locale);
    systemPromptRef.current = prompt;
    return prompt;
  }, [data.assets, data.transactions, data.savingsPlans, data.profile.currency, valuation, locale]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !config || !provider || streaming) return;

      const system = buildSystemPromptOnce();
      const userMsg: ChatUiMessage = { id: genId(), role: "user", content: trimmed };
      const assistantId = genId();

      setErrorMessageKey(null);
      setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
      setStreaming(true);
      setAwaitingFirstDelta(true);

      const wireHistory = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const handle = provider.chat(
        { model: config.model, messages: wireHistory, system },
        config.key,
      );
      streamRef.current = handle;

      void (async () => {
        try {
          for await (const delta of handle) {
            setAwaitingFirstDelta(false);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
            );
          }
        } catch (err) {
          const aborted = err instanceof DOMException && err.name === "AbortError";
          if (!aborted) {
            setErrorMessageKey(llmErrorMessageKey(err instanceof LlmChatError ? err.code : undefined));
          }
        } finally {
          setStreaming(false);
          setAwaitingFirstDelta(false);
          streamRef.current = null;
        }
      })();
    },
    [config, provider, streaming, messages, buildSystemPromptOnce],
  );

  const stop = useCallback(() => {
    streamRef.current?.cancel();
  }, []);

  const newChat = useCallback(() => {
    streamRef.current?.cancel();
    streamRef.current = null;
    systemPromptRef.current = null;
    setMessages([]);
    setStreaming(false);
    setAwaitingFirstDelta(false);
    setErrorMessageKey(null);
  }, []);

  return {
    messages,
    streaming,
    awaitingFirstDelta,
    errorMessageKey,
    providerLabel: provider?.label ?? "",
    canSend: !!config && !!provider && !streaming,
    send,
    stop,
    newChat,
  };
}
