// @vitest-environment jsdom
//
// Watchlist rows whose price needs the one-shot /api/price fallback must show
// a Skeleton while that fetch is in flight, never the "-" placeholder (the
// dash is reserved for the genuine no-data case, once the fetch has settled).
// All context hooks are mocked directly (no provider tree), fetch is
// stubbed via vi.stubGlobal (same pattern as tests/yahoo-throttle.test.ts) so
// its resolution can be controlled deterministically with a deferred promise.

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { WatchlistCard } from "../components/dashboard/watchlist-card";
import type { WatchlistItem } from "../lib/types";

const item: WatchlistItem = {
  id: "w1",
  isin: null,
  wkn: null,
  symbol: "GME",
  name: "GameStop Corp.",
  type: "STOCK",
  currency: null,
};

vi.mock("@/lib/portfolio/portfolio-context", () => ({
  usePortfolio: () => ({
    data: { watchlist: [item], profile: { currency: "EUR" } },
    addWatchlistItem: vi.fn(),
    removeWatchlistItem: vi.fn(),
  }),
}));

vi.mock("@/lib/catalog/catalog-context", () => ({
  useCatalog: () => ({ version: 0 }),
}));

vi.mock("@/lib/catalog/catalog", () => ({
  lookupInstrument: () => null,
}));

vi.mock("@/lib/flags/flags-context", () => ({
  useFeatureFlag: () => true,
}));

vi.mock("@/lib/i18n/i18n-context", () => ({
  useI18n: () => ({ locale: "en", setLocale: () => {}, t: (key: string) => key }),
}));

describe("WatchlistCard price-loading skeleton", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a skeleton while the one-shot price fetch is pending, then the dash once it settles without a price", async () => {
    let resolveFetch: (v: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(WatchlistCard));

    // Fetch kicked off; row shows a skeleton, not a dash, while it's pending.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const row = screen.getByText("GameStop Corp.").closest("li")!;
    expect(row.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(row.textContent).not.toContain("—");

    resolveFetch({
      ok: true,
      json: async () => ({ found: false }),
    } as Response);

    await waitFor(() => expect(row.querySelector('[aria-hidden="true"]')).toBeNull());
    expect(row.textContent).toContain("—");
  });
});
