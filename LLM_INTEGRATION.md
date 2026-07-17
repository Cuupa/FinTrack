# LLM Integration — Design Plan

Status: PLAN (no implementation yet). Feature-flagged, off by default.

## Goal

Users bring their own API key from an LLM provider of their choice. Once
configured, a chat bubble appears bottom-right. Opening it starts a chat whose
context includes the user's portfolio (assets, savings plans, risk metrics,
allocation), so they can ask for portfolio insights in natural language.

## Non-goals

- No FinTrack-hosted/paid LLM proxy with our own key (BYO key only).
- No autonomous actions: the assistant never mutates portfolio data.
- No investment advice: same "Modellwerte, keine Anlageberatung" framing as
  the simulation pages, repeated inside the chat UI.

## Provider abstraction

```
lib/llm/
  types.ts        ChatMessage, ChatRequest, StreamHandle, LlmProvider
  providers/
    anthropic.ts  Claude (claude-sonnet-5 default)
    openai.ts     GPT (gpt-*)
    gemini.ts     Google (gemini-*)
  context.ts      buildPortfolioContext(data, valuation, stats) -> compact JSON
  llm-context.tsx LlmProvider react context: config state + chat state
```

`LlmProvider` is the single seam (mirrors the `DataStore`/`PriceProvider`
pattern): `{ id, label, models, chat(request, key): AsyncIterable<delta> }`.
UI and context code never branch on the provider.

## Key handling & data flow (the critical decisions)

1. **API key storage: localStorage only** (`fintrack-llm`, versioned schema
   like `fintrack-tags`), deliberately NOT in the store seam / DB. Rationale:
   the server must never hold long-lived third-party credentials, guest mode
   works identically, and the tags feature sets the precedent (disclosed in
   /datenschutz). Cleared on sign-out like the history cache.
2. **Requests go through a server proxy route** `/api/llm` (POST, streaming
   SSE passthrough). The browser sends `{ provider, model, key, messages }`;
   the route forwards to the provider and pipes the stream back. Rationale:
   CSP `connect-src` stays `'self' + *.supabase.co` (adding three vendor
   origins client-side was considered and rejected — the proxy matches the
   existing "market-data calls are server-side by design" rule). The key is
   used per-request and never logged or persisted server-side.
3. **Rate limiting**: reuse `lib/server/rate-limit.ts` (per-IP, fail-open
   without Supabase) on `/api/llm` like the market-data routes.
4. **Payload cap**: request body capped (context is compact by construction,
   see below); reject > 256 KB like `/api/share`.

## Portfolio context

`buildPortfolioContext()` runs client-side on data already in memory
(usePortfolio + useLivePrices + stats.ts), produces compact JSON:

- holdings: name, type, ISIN (no ids), qty, value in base ccy, weight, P&L,
  unrealised/realised, dividend yield
- savings plans: instrument, amount, frequency, next run
- risk: per-asset mu/sigma (stats.ts), portfolio sigma, Sharpe, max drawdown,
  volatility bands from allocation.ts
- allocation: by class/currency/region percentages
- base currency, locale, "today" date

Sent as a system-prompt preamble on each conversation start. The user opts in
per browser by entering a key; a one-time consent note in the chat header
states that portfolio data is sent to the chosen provider.

## UX

- **Settings card "KI-Assistent"**: provider select (SelectMenu), model
  select, key input (password field, show/hide), "Verbindung testen" button
  (1-token ping via `/api/llm`), remove-key button (ConfirmDialog, destructive).
- **Chat bubble** bottom-right (all pages, above mobile nav), only when
  flag enabled AND key configured. Opens a panel (mobile: full-screen sheet,
  desktop: 420px panel) with message list, streaming responses, stop button,
  "new chat". Focus-trapped (`use-focus-trap`), `role="dialog"`.
- Suggested starter prompts ("Wie ist mein Portfolio diversifiziert?", ...).
- Skeleton loading dots while streaming starts; errors localized
  (key invalid / rate limited / provider down). No badges anywhere.
- i18n: all copy EN/DE/ES, German in du-register, no em-dashes.

## Feature flag

`feature_flags` row `llmChat`, seeded **disabled** (migration + schema.sql,
idempotent). Component gate via `useFeatureFlag("llmChat")`; per-user
overrides work as everywhere. No env vars.

## Privacy / legal (must ship in the same change)

/datenschutz gains a section: feature is opt-in, key stored only in this
browser, portfolio data is transmitted to the chosen provider when the chat
is used, link to provider DPAs. The privacy policy's "server-side market-data
calls" claim stays accurate because `/api/llm` is server-side and stateless.

## Phases

1. **P1 Core**: provider seam + `/api/llm` proxy (streaming) + settings card +
   key storage + flag + datenschutz. Anthropic + OpenAI adapters.
2. **P2 Chat UX**: bubble + panel + context builder + starter prompts +
   consent note. Gemini adapter.
3. **P3 Polish**: conversation persistence (localStorage, capped), token/cost
   hint per provider, context scoping toggles (holdings only / + plans / +
   risk).

## Test strategy

- Pure: context builder (fixture portfolio → expected compact JSON), provider
  request mappers (messages → vendor wire format), key-schema migration.
- Route: `/api/llm` auth-less streaming passthrough with mocked fetch,
  rate-limit behavior, payload cap.
- E2E (local, mocked provider): configure key → bubble appears → send message
  → streamed reply renders; flag off → nothing renders.

## Open questions for the owner

1. Which providers first? (Plan assumes Anthropic + OpenAI in P1.)
2. Should the chat see the tax report (Freistellungsauftrag amounts)? Left
   out of P1 context on purpose.
3. Conversation history persistence wanted at all, or always-fresh chats?
