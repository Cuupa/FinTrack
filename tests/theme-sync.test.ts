// @vitest-environment jsdom
//
// ThemeSync (components/theme-sync.tsx) applies profiles.theme to the real
// ThemeProvider once portfolio data loads, mirroring the locale-sync idiom
// (components/locale-sync.tsx, no dedicated test file exists for it either).
// Same mocking approach as tests/watchlist-card.test.ts: usePortfolio is
// mocked directly; ThemeProvider itself is real so localStorage and the
// exposed effective theme are asserted end-to-end.

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../lib/theme/theme-context";
import { ThemeSync } from "../components/theme-sync";
import { DEFAULT_PROFILE } from "../lib/types";
import type { Profile } from "../lib/types";

const portfolioMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/portfolio/portfolio-context", () => ({
  usePortfolio: portfolioMock,
}));

function Probe() {
  const { theme, explicit } = useTheme();
  return createElement("div", { "data-testid": "probe" }, `${theme}:${explicit ?? "system"}`);
}

function renderWithProfile(profile: Partial<Profile>) {
  portfolioMock.mockReturnValue({ data: { profile: { ...DEFAULT_PROFILE, ...profile } } });
  return render(createElement(ThemeProvider, null, createElement(ThemeSync), createElement(Probe)));
}

describe("ThemeSync", () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom doesn't implement matchMedia; ThemeProvider reads it to derive
    // the system preference and to watch for OS-level changes.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
  });

  it("applies profile.theme on load, overriding the system default", async () => {
    renderWithProfile({ theme: "dark" });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("dark:dark"));
    expect(localStorage.getItem("fintrack-theme")).toBe("dark");
  });

  it("leaves the local/system theme alone when profile.theme is null", async () => {
    renderWithProfile({ theme: null });
    // No saved value, system preference mocked to light: stays on "light",
    // no explicit choice ever gets written.
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("light:system"));
    expect(localStorage.getItem("fintrack-theme")).toBeNull();
  });

  it("profile.theme overrides a differing local explicit choice (the profile is the source of truth across devices)", async () => {
    localStorage.setItem("fintrack-theme", "light");
    renderWithProfile({ theme: "dark" });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("dark:dark"));
    expect(localStorage.getItem("fintrack-theme")).toBe("dark");
  });
});
