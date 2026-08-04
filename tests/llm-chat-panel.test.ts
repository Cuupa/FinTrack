// @vitest-environment jsdom

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChatPanel } from "../components/llm/chat-panel";
import type { PortfolioChat } from "../components/llm/use-portfolio-chat";

vi.mock("@/lib/i18n/i18n-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const chat: PortfolioChat = {
  messages: [],
  streaming: false,
  awaitingFirstDelta: false,
  errorMessageKey: null,
  providerLabel: "Test provider",
  canSend: true,
  send: vi.fn(),
  stop: vi.fn(),
  newChat: vi.fn(),
};

describe("ChatPanel", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  it("leaves page scrolling unchanged while it is open", () => {
    document.body.style.overflow = "scroll";

    const { unmount } = render(createElement(ChatPanel, { chat, onClose: vi.fn() }));

    expect(document.body.style.overflow).toBe("scroll");

    unmount();
    expect(document.body.style.overflow).toBe("scroll");
  });
});
