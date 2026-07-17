"use client";

// Floating chat bubble, mounted once at the root (app/layout.tsx) so it's
// available on every page. Rendered only when the `llmChat` flag is on AND
// the user has a configured LLM key (lib/llm/llm-context.tsx) — the two
// gates from LLM_INTEGRATION.md's UX section.
//
// Position mirrors the offline sync pill's bottom-right anchor
// (components/offline/sync-pill.tsx): `bottom-20 right-4 md:bottom-6` sits
// above the fixed mobile tab bar (components/mobile-nav.tsx) on small
// screens, and drops to a tighter corner offset from md: up where there is
// no bottom nav. While the panel is open, the toggle button itself is
// unmounted (the panel provides its own close affordance) rather than both
// occupying the same corner.

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useLlmConfig } from "@/lib/llm/llm-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { usePortfolioChat } from "./use-portfolio-chat";
import { ChatPanel } from "./chat-panel";

export function ChatBubble() {
  const enabled = useFeatureFlag("llmChat");
  const { configured } = useLlmConfig();
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Sticky (never reset): first open arms the chat hook's history/benchmark
  // fetches, and keeps them armed after close so the built context survives
  // reopening — while users who never open the panel never fetch.
  const [armed, setArmed] = useState(false);

  // Conversation state is owned here (not inside ChatPanel) so it survives
  // closing and reopening the panel within the session.
  const chat = usePortfolioChat(armed);

  // Shared portfolios are a read-only external view of someone ELSE's data
  // (components/mobile-nav.tsx applies the same exclusion) — the bubble would
  // otherwise offer to chat about the viewer's own portfolio on a page about
  // somebody else's, which is the wrong context entirely.
  if (pathname.startsWith("/shared")) return null;
  if (!enabled || !configured) return null;

  if (open) {
    return <ChatPanel chat={chat} onClose={() => setOpen(false)} />;
  }

  return (
    <button
      type="button"
      onClick={() => {
        setOpen(true);
        setArmed(true);
      }}
      aria-label={t("llm.chat.openLabel")}
      className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-emerald-500 md:bottom-6 dark:bg-emerald-500 dark:hover:bg-emerald-400"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
        aria-hidden="true"
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    </button>
  );
}
