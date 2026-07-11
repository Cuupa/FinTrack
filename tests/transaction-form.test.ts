// @vitest-environment jsdom
//
// TransactionForm's create-on-first-transaction seam: when `ensureAsset` is
// passed (asset-detail.tsx does this for a not-(yet-)held instrument), submit
// must resolve the real asset through it and book the transaction against
// THAT asset's id, never the sentinel wl:/cat: id carried by `asset`. All
// context hooks the form consumes are mocked directly (no provider tree) —
// usePortfolio for addTransaction, useI18n/useCatalog/useLivePrices as inert
// stand-ins. Asset type CRYPTO so the STOCK/ETF-only live-price-refresh effect
// never fires and fetchLivePrice needs no mock. Uses createElement (not JSX)
// so this file can stay a plain .test.ts per the project's vitest include
// pattern (tests/**/*.test.ts).

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { TransactionForm } from "../components/assets/transaction-form";
import type { Asset } from "../lib/types";

const addTransactionMock = vi.hoisted(() =>
  vi.fn(async (input: unknown) => ({ id: "tx1", ...(input as object) })),
);

vi.mock("@/lib/portfolio/portfolio-context", () => ({
  usePortfolio: () => ({
    addTransaction: addTransactionMock,
    createPortfolio: vi.fn(),
    portfolios: [{ id: "p1", name: "Main" }],
    selectedPortfolioIds: ["p1"],
  }),
}));

vi.mock("@/lib/i18n/i18n-context", () => ({
  useI18n: () => ({ locale: "en", setLocale: () => {}, t: (key: string) => key }),
}));

vi.mock("@/lib/catalog/catalog-context", () => ({
  useCatalog: () => ({ version: 0 }),
}));

vi.mock("@/lib/live/live-prices-context", () => ({
  useLivePrices: () => ({ valuation: { base: "EUR" }, stale: false, asOf: null }),
}));

const nonHeldAsset: Asset = {
  id: "wl:w1",
  isin: null,
  wkn: null,
  symbol: "BTC",
  name: "Bitcoin",
  type: "CRYPTO",
  currency: "EUR",
  notes: null,
};

const realAsset: Asset = { ...nonHeldAsset, id: "real-asset-id" };

describe("TransactionForm ensureAsset seam", () => {
  beforeEach(() => {
    addTransactionMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("books the transaction against the id ensureAsset resolves, not the sentinel asset.id", async () => {
    const ensureAsset = vi.fn(async () => realAsset);
    render(createElement(TransactionForm, { asset: nonHeldAsset, ensureAsset }));

    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "3" } });

    const [submitButton] = screen.getAllByRole("button", { name: /tx\.add/ });
    fireEvent.click(submitButton);

    await waitFor(() => expect(addTransactionMock).toHaveBeenCalledTimes(1));

    expect(ensureAsset).toHaveBeenCalledTimes(1);
    const bookedInput = addTransactionMock.mock.calls[0][0] as { assetId: string };
    expect(bookedInput.assetId).toBe("real-asset-id");
    expect(bookedInput.assetId).not.toBe(nonHeldAsset.id);
  });

  it("books against asset.id directly when ensureAsset is not provided", async () => {
    render(createElement(TransactionForm, { asset: realAsset }));

    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "2" } });

    const [submitButton] = screen.getAllByRole("button", { name: /tx\.add/ });
    fireEvent.click(submitButton);

    await waitFor(() => expect(addTransactionMock).toHaveBeenCalledTimes(1));

    const bookedInput = addTransactionMock.mock.calls[0][0] as { assetId: string };
    expect(bookedInput.assetId).toBe("real-asset-id");
  });
});
