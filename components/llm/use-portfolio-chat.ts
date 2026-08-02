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
import { accountValueOn } from "@/lib/finance/accounts";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { nextPlannedOccurrence, plannedMonthlyTotals } from "@/lib/finance/planned";
import {
  budgetProgress,
  incomeExpenseSplit,
  toBaseCurrency,
  withoutTransfers,
} from "@/lib/finance/spending";
import { monthlyEquivalent, nextBooking } from "@/lib/finance/contract-bookings";
import { goalTotals, subGoals, topLevelGoals } from "@/lib/finance/goals";
import { projectPension } from "@/lib/finance/pension";
import { usePensionReference } from "@/lib/pension/use-pension-reference";
import { computeFirePlan, trailingAnnualExpenses } from "@/lib/finance/fire";
import { monthlyContributionOf } from "@/lib/finance/savings-plans";
import { useFeatureFlag } from "@/lib/flags/flags-context";
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
// The FIRE page's default withdrawal rate (the classic 4% rule). Its slider is
// live what-if state that never leaves the component, so the snapshot reports
// the plan at the default rather than at a position the user may have dragged.
const DEFAULT_WITHDRAWAL_RATE = 0.04;

/**
 * `active` arms the async context inputs (real histories + benchmark for
 * beta/alpha): false until the user first opens the panel, so the bubble's
 * root mount never fetches for users who don't use the chat.
 */
export function usePortfolioChat(active: boolean): PortfolioChat {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  // Same carried-forward balances the dashboard shows, so the assistant never
  // quotes a figure the user cannot find anywhere on screen.
  const movements = useAccountMovements();
  // Subscribed for `version` so histItems (and the dividend-yield/country
  // lookups) refresh once the catalog finishes loading — lookups themselves
  // go through the module-level lib/catalog/catalog.ts functions, same as
  // allocation.ts.
  const { version } = useCatalog();
  const { locale } = useI18n();
  const { config } = useLlmConfig();
  const plannedEnabled = useFeatureFlag("plannedCashflow");
  // One flag per section. A section is passed only when its flag is on, so the
  // assistant is never better informed than the app the user is looking at.
  const spendingEnabled = useFeatureFlag("spending");
  const budgetsEnabled = useFeatureFlag("budgets");
  const contractsEnabled = useFeatureFlag("contracts");
  const goalsEnabled = useFeatureFlag("goals");
  const pensionEnabled = useFeatureFlag("pension");
  const fireEnabled = useFeatureFlag("firePlanner");
  const watchlistEnabled = useFeatureFlag("watchlist");
  const pensionReference = usePensionReference();
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

    const stats = estimatePortfolioStats(statHoldings, 5, histories);

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

    // Planned income/expenses: the recurring figures per month plus the next
    // expected payment per plan, converted to the base currency. Ids never
    // leave the client (same rule as the rest of this snapshot).
    const todayIso = today();
    const planned =
      plannedEnabled && data.plannedCashflows.length > 0
        ? {
            monthly: plannedMonthlyTotals(data.plannedCashflows, data.accounts, base, fxSpot),
            upcoming: data.plannedCashflows
              .map((p) => {
                const date = nextPlannedOccurrence(p, todayIso);
                if (!date) return null;
                const cur = data.accounts.find((a) => a.id === p.accountId)?.currency || base;
                const rate = cur === base ? 1 : (fxSpot[cur] ?? 1);
                return { name: p.name, date, amount: p.amount * rate };
              })
              .filter((p): p is { name: string; date: string; amount: number } => p !== null)
              .sort((a, b) => a.date.localeCompare(b.date)),
          }
        : null;

    // Everyday money and planning. Each block mirrors the computation its own
    // page performs, so the assistant quotes figures the user can find on
    // screen rather than a second opinion computed here.
    const baseTx = toBaseCurrency(data.spendingTransactions, data.accounts, base, fxSpot);
    const realTx = withoutTransfers(baseTx);

    const yearAgo = `${Number(todayIso.slice(0, 4)) - 1}${todayIso.slice(4)}`;
    const trailing = realTx.filter((tx) => tx.date >= yearAgo && tx.date <= todayIso);
    const categoryNames = new Map(
      data.spendingCategories.map((c) => [c.id, `${c.groupName} · ${c.name}`]),
    );
    const spentByCategory = new Map<string, number>();
    for (const tx of trailing) {
      if (tx.amount >= 0) continue;
      const name = categoryNames.get(tx.categoryId ?? "") ?? "Uncategorized";
      spentByCategory.set(name, (spentByCategory.get(name) ?? 0) + -tx.amount);
    }
    const split = incomeExpenseSplit(trailing);
    const spending =
      spendingEnabled && data.spendingTransactions.length > 0
        ? {
            trailing12m: { income: split.income, expense: split.expense },
            topCategories: [...spentByCategory.entries()]
              .map(([name, amount]) => ({ name, amount }))
              .sort((a, b) => b.amount - a.amount)
              .slice(0, 12),
          }
        : null;

    const budgets =
      budgetsEnabled && data.budgets.length > 0
        ? budgetProgress(baseTx, data.budgets, todayIso.slice(0, 7)).map((b) => ({
            category: categoryNames.get(b.categoryId) ?? "?",
            cap: b.cap,
            spent: b.spent,
          }))
        : null;

    const contracts =
      contractsEnabled && data.contracts.length > 0
        ? data.contracts.map((c) => ({
            name: c.name,
            monthly: monthlyEquivalent(c),
            interval: c.interval,
            nextDue: nextBooking(c, todayIso),
          }))
        : null;

    // Composite parents report the sum over their parts (`goalTotals`), and the
    // parts themselves are left out so the same money is not counted twice.
    const goals =
      goalsEnabled && data.goals.length > 0
        ? topLevelGoals(data.goals).map((g) => {
            const totals = goalTotals(
              g,
              subGoals(data.goals, g.id),
              data.accounts,
              data.accountBalances,
              { base, fx: fxSpot },
              undefined,
              movements,
            );
            return {
              name: g.name,
              target: totals.target,
              current: totals.current,
              targetDate: g.targetDate ?? null,
            };
          })
        : null;

    const projection = pensionEnabled
      ? projectPension({
          entries: data.pensionPoints,
          statements: data.pensionStatements,
          contracts: data.pensionContracts,
          reference: pensionReference,
          settings: data.profile.pensionSettings,
          currentYear: Number(todayIso.slice(0, 4)),
        })
      : null;
    const pension =
      projection && (projection.totalPoints > 0 || projection.monthlyPrivate > 0)
        ? {
            totalPoints: projection.totalPoints,
            statutoryMonthly: projection.monthlyStatutory,
            privateMonthly: projection.monthlyPrivate,
            totalMonthly: projection.monthlyTotal,
            retirementYear: projection.retirementYear,
          }
        : null;

    // The FIRE page's own defaults: trailing expenses, the savings plans'
    // monthly contribution and the measured expected return. The withdrawal
    // rate is the page's 4% default, since a slider position is UI state that
    // deliberately never leaves the component.
    const annualExpenses = trailingAnnualExpenses(data.spendingTransactions, todayIso);
    const netWorth =
      holdings.reduce((s, h) => s + h.marketValue, 0) +
      data.accounts.reduce(
        (s, a) =>
          s + accountValueOn(a, data.accountBalances, todayIso, { base, fx: fxSpot }, movements),
        0,
      );
    const plan =
      fireEnabled && annualExpenses > 0
        ? computeFirePlan(
            netWorth,
            annualExpenses,
            monthlyContributionOf(data.savingsPlans, data.assets, valuation),
            stats?.expectedReturn ?? 0,
            DEFAULT_WITHDRAWAL_RATE,
          )
        : null;
    const fire = plan
      ? {
          annualExpenses,
          withdrawalRate: plan.withdrawalRate,
          fireNumber: plan.regular,
          leanFireNumber: plan.lean,
          fatFireNumber: plan.fat,
          yearsToFire: plan.yearsToRegular,
        }
      : null;

    // Tag values are the user's own words, so they travel verbatim -- but the
    // group and value IDS never do, only the "Group=Value" reading.
    const groupNames = new Map(data.tagGroups.map((g) => [g.id, g.name]));
    const tags: Record<string, string[]> = {};
    for (const asset of data.assets) {
      const byGroup = data.tagAssignments[asset.id];
      if (!byGroup) continue;
      const labels: string[] = [];
      for (const [groupId, values] of Object.entries(byGroup)) {
        const group = groupNames.get(groupId);
        if (!group) continue;
        for (const value of values) labels.push(`${group}=${value}`);
      }
      if (labels.length) tags[assetPriceKey(asset)] = labels;
    }

    const contextJson = buildPortfolioContext({
      baseCurrency: base,
      today: todayIso,
      holdings,
      assets: data.assets,
      savingsPlans: data.savingsPlans,
      dividendYields,
      // No-holdings falls back to null here (not a benchmark) — an empty
      // portfolio should read as empty to the assistant, not as "invested
      // like FTSE All-World".
      portfolioStats: stats,
      riskStats: portfolioRiskStats(statHoldings, 5, histories),
      benchmark: ba ? { name: compare[0]?.label ?? "MSCI World", ...ba } : null,
      allocationByClass: byAssetClass(holdings),
      allocationByCurrency: byCurrency(holdings, base),
      allocationByCountry: byCountry(holdings),
      // Balance accounts & liabilities (ROADMAP #1) — id-free, base-currency
      // signed balances so the assistant sees whole-picture net worth.
      accounts: data.accounts.length
        ? data.accounts.map((a) => ({
            name: a.name,
            kind: a.kind,
            currency: a.currency ?? base,
            isLiability: a.isLiability,
            balance: accountValueOn(
              a,
              data.accountBalances,
              today(),
              { base, fx: fxSpot },
              movements,
            ),
          }))
        : undefined,
      // Planned income/expenses (flag `plannedCashflow`) — id-free, base
      // currency, so the assistant knows a salary is coming instead of reading
      // the ledger as the user's entire income. Only when the flag is on.
      planned,
      spending,
      budgets,
      contracts,
      goals,
      pension,
      fire,
      watchlist:
        watchlistEnabled && data.watchlist.length > 0
          ? data.watchlist.map((w) => w.name)
          : undefined,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
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
    data.accounts,
    data.accountBalances,
    data.plannedCashflows,
    data.spendingTransactions,
    data.spendingCategories,
    data.budgets,
    data.contracts,
    data.goals,
    data.pensionPoints,
    data.pensionStatements,
    data.pensionContracts,
    data.profile.pensionSettings,
    data.watchlist,
    data.tagGroups,
    data.tagAssignments,
    pensionReference,
    plannedEnabled,
    spendingEnabled,
    budgetsEnabled,
    contractsEnabled,
    goalsEnabled,
    pensionEnabled,
    fireEnabled,
    watchlistEnabled,
    base,
    valuation,
    locale,
    histories,
    histLoading,
    benchLevels,
    compare,
    movements,
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
