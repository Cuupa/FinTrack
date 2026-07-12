// @vitest-environment jsdom
//
// ThemeToggle (components/theme-toggle.tsx) persists the explicit choice to
// the profile in addition to localStorage, mirroring how LocaleSwitcher
// persists profile.locale (components/locale-switcher.tsx). usePortfolio /
// useI18n are mocked directly, same pattern as tests/watchlist-card.test.ts;
// ThemeProvider itself is real so the localStorage write is asserted
// end-to-end alongside the profile persistence call.

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../lib/theme/theme-context";
import { ThemeToggle } from "../components/theme-toggle";

const updateProfileMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/portfolio/portfolio-context", () => ({
  usePortfolio: () => ({ updateProfile: updateProfileMock }),
}));

vi.mock("@/lib/i18n/i18n-context", () => ({
  useI18n: () => ({ locale: "en", setLocale: () => {}, t: (key: string) => key }),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    updateProfileMock.mockClear();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
  });

  it("flips localStorage and persists the explicit choice to the profile", () => {
    render(createElement(ThemeProvider, null, createElement(ThemeToggle)));

    fireEvent.click(screen.getByRole("button"));

    expect(localStorage.getItem("fintrack-theme")).toBe("dark");
    expect(updateProfileMock).toHaveBeenCalledWith({ theme: "dark" });
  });
});
