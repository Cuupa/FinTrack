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
// real chat's system prompt is fixed for the session. One exception: while
// the async inputs (real histories + benchmark) are still in flight, the
// prompt is rebuilt per send instead of cached, so beta/alpha and
// history-based stats join the context as soon as the fetches land rather
// than being locked out of the whole conversation by a fast first send.

import { useCallback, useMemo, useRef, useState } from "react";
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
import { betaAlpha, compositeLevelSeries } from "@/lib/finance/returns";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { useBenchmarkCompare } from "@/components/charts/use-benchmark-compare";
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

// External benchmark for the context's beta/alpha — the same MSCI World pin
// as the risk page (components/analysis/risk-view.tsx).
const BENCHMARK_IDS = ["msci-world"];
const NO_BENCHMARKS: string[] = [];
// Lookback for the history fetch, matching the 5-year default of
// estimatePortfolioStats/portfolioRiskStats.
const HISTORY_RANGE = "5Y";

/**
 * `active` arms the async context inputs (real histories + benchmark for
 * beta/alpha): false until the user first opens the panel, so the bubble's
 * root mount never fetches for users who don't use the chat.
 */
export function usePortfolioChat(active: boolean): PortfolioChat {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  // Subscribed for `version` so histItems (and the dividend-yield/country
  // lookups) refresh once the catalog finishes loading — lookups themselves
  // go through the module-level lib/catalog/catalog.ts functions, same as
  // allocation.ts.
  const { version } = useCatalog();
  const { locale } = useI18n();
  const { config } = useLlmConfig();
  const base = data.profile.currency;

  const histItems = useMemo(
    () =>
      active
        ? data.assets.map(quoteItemFor).filter((x): x is NonNullable<typeof x> => x !== null)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version, active],
  );
  const { histories, loading: histLoading } = useHistory(histItems, HISTORY_RANGE, base);
  const compare = useBenchmarkCompare(active ? BENCHMARK_IDS : NO_BENCHMARKS, base);
  const benchLevels = useMemo(
    () => (compare[0]?.points ?? []).filter((p) => p.value > 0),
    [compare],
  );

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

    // Portfolio-level beta/alpha vs MSCI World: each held asset's real
    // history normalised into the base currency (spot FX), value-weighted
    // into one composite level series — the same computation basis as the
    // risk page's KPI tiles (risk-view.tsx), so the assistant quotes the
    // figures the user sees there.
    const fxSpot = valuation.fx ?? {};
    const assetLevels = holdings
      .filter((h) => h.position.shares > 0)
      .map((h) => {
        const hist = histories[assetPriceKey(h.asset)];
        const cur = h.asset.currency ?? base;
        const rate = cur === base ? 1 : (fxSpot[cur] ?? 1);
        return {
          levels: hist ? hist.map((p) => ({ date: p.date, value: p.close * rate })) : [],
          weight: h.marketValue,
        };
      });
    const compositeLevels = compositeLevelSeries(assetLevels);
    const ba =
      compositeLevels.length >= 3 && benchLevels.length >= 3
        ? betaAlpha(compositeLevels, benchLevels)
        : null;

    const contextJson = buildPortfolioContext({
      baseCurrency: base,
      today: today(),
      holdings,
      assets: data.assets,
      savingsPlans: data.savingsPlans,
      dividendYields,
      // No-holdings falls back to null here (not a benchmark) — an empty
      // portfolio should read as empty to the assistant, not as "invested
      // like FTSE All-World".
      portfolioStats: estimatePortfolioStats(statHoldings, 5, histories),
      riskStats: portfolioRiskStats(statHoldings, 5, histories),
      benchmark: ba ? { name: compare[0]?.label ?? "MSCI World", ...ba } : null,
      allocationByClass: byAssetClass(holdings),
      allocationByCurrency: byCurrency(holdings, base),
      allocationByCountry: byCountry(holdings),
    });

    const prompt = buildSystemPrompt(contextJson, locale);
    // Cache only once the async inputs have arrived (see the header comment):
    // until then each send rebuilds the prompt with whatever is available.
    if (!histLoading && benchLevels.length >= 3) systemPromptRef.current = prompt;
    return prompt;
  }, [
    data.assets,
    data.transactions,
    data.savingsPlans,
    base,
    valuation,
    locale,
    histories,
    histLoading,
    benchLevels,
    compare,
  ]);

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
