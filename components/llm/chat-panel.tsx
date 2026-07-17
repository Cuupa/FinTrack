"use client";

// The chat panel: desktop a ~420px fixed panel bottom-right, mobile a
// full-screen sheet. Follows Modal's a11y conventions (role="dialog",
// focus-trapped via the shared use-focus-trap hook, Escape closes, background
// scroll locked) without reusing Modal itself — Modal is a centered overlay,
// this is anchored bottom-right on desktop, which needs its own layout.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFocusTrap } from "@/components/ui/use-focus-trap";
import { Button } from "@/components/ui/primitives";
import type { PortfolioChat } from "./use-portfolio-chat";
import type { MessageKey } from "@/lib/i18n/dictionaries";

export function ChatPanel({ chat, onClose }: { chat: PortfolioChat; onClose: () => void }) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");

  useFocusTrap(panelRef, true);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Auto-scroll to the newest content (new message, or a streamed delta
  // appended to the last one). Imperative DOM scroll, not React state, so
  // this is fine to run directly in the effect body.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.errorMessageKey, chat.awaitingFirstDelta]);

  function trySend() {
    const text = draft.trim();
    if (!text || !chat.canSend) return;
    chat.send(text);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      trySend();
    }
  }

  function pickStarter(text: string) {
    if (!chat.canSend) return;
    chat.send(text);
  }

  const showStarters = chat.messages.length === 0;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("llm.chat.title")}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-white outline-none dark:bg-zinc-950 md:inset-auto md:bottom-6 md:right-4 md:h-[min(600px,80vh)] md:w-[420px] md:rounded-xl md:border md:border-zinc-200 md:shadow-2xl md:dark:border-zinc-800"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("llm.chat.title")}</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {t("llm.chat.consent", { provider: chat.providerLabel })} {t("disclaimer.short")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={chat.newChat}
            disabled={chat.messages.length === 0 && !chat.errorMessageKey}
          >
            {t("llm.chat.newChat")}
          </Button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("llm.chat.close")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {showStarters && <StarterPrompts onPick={pickStarter} disabled={!chat.canSend} />}

        {chat.messages.map((m, i) => {
          const isLastAssistant = i === chat.messages.length - 1 && m.role === "assistant";
          if (m.role === "assistant" && m.content === "") {
            if (isLastAssistant && chat.awaitingFirstDelta) return <TypingRow key={m.id} />;
            return null;
          }
          return <MessageRow key={m.id} role={m.role} content={m.content} />;
        })}

        {chat.errorMessageKey && <ErrorRow messageKey={chat.errorMessageKey} />}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          trySend();
        }}
        className="border-t border-zinc-200 p-3 dark:border-zinc-800"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={chat.streaming}
            rows={1}
            placeholder={t("llm.chat.placeholder")}
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700"
          />
          {chat.streaming ? (
            <Button type="button" variant="secondary" onClick={chat.stop}>
              {t("llm.chat.stop")}
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!draft.trim() || !chat.canSend}>
              {t("llm.chat.send")}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function MessageRow({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
          isUser
            ? "rounded-br-sm bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "rounded-bl-sm bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        {content}
      </p>
    </div>
  );
}

function TypingRow() {
  const { t } = useI18n();
  return (
    <div className="flex justify-start">
      <div
        role="status"
        aria-label={t("llm.chat.typing")}
        className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2.5 dark:bg-zinc-800"
      >
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s] motion-reduce:animate-none dark:bg-zinc-500" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s] motion-reduce:animate-none dark:bg-zinc-500" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 motion-reduce:animate-none dark:bg-zinc-500" />
      </div>
    </div>
  );
}

function ErrorRow({ messageKey }: { messageKey: MessageKey }) {
  const { t } = useI18n();
  return <p className="px-1 text-sm text-red-600 dark:text-red-400">{t(messageKey)}</p>;
}

function StarterPrompts({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  const prompts = [
    t("llm.chat.starterDiversification"),
    t("llm.chat.starterRisks"),
    t("llm.chat.starterSavingsPlans"),
  ];
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">{t("llm.chat.starterHint")}</p>
      <div className="flex flex-col gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => onPick(p)}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
