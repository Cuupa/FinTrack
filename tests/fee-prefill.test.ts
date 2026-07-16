// @vitest-environment jsdom
//
// Wiring test for the settings "Broker & fees" prefill (lib/finance/fees.ts):
// AddAssetForm's opening-transaction fee input and TransactionForm's fee
// input must prefill from the selected portfolio's order-fee model and keep
// tracking it live until the user edits the field directly. All context
// hooks are mocked directly (no provider tree), mirroring
// tests/transaction-form.test.ts. Uses createElement (not JSX) so this file
// can stay a plain .test.ts per the project's vitest include pattern
// (tests/**/*.test.ts). No jest-dom in this project, so assertions read
// `.value` off the input directly instead of `toHaveValue`.

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { AddAssetForm } from "../components/assets/add-asset-form";
import { TransactionForm } from "../components/assets/transaction-form";
import type { Asset, Portfolio } from "../lib/types";

const addAssetMock = vi.hoisted(() =>
  vi.fn(async (input: unknown) => ({ id: "asset1", ...(input as object) })),
);
const addTransactionMock = vi.hoisted(() =>
  vi.fn(async (input: unknown) => ({ id: "tx1", ...(input as object) })),
);

// Mutable so each test can point usePortfolio at a different fee model
// before rendering — the mock factory below reads it at call time.
let portfolios: Portfolio[] = [];

vi.mock("@/lib/portfolio/portfolio-context", () => ({
  usePortfolio: () => ({
    addAsset: addAssetMock,
    addTransaction: addTransactionMock,
    createPortfolio: vi.fn(),
    data: { assets: [], transactions: [], profile: { currency: "EUR" } },
    portfolios,
    selectedPortfolioIds: portfolios.length > 0 ? [portfolios[0].id] : [],
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

function val(el: Element): string {
  return (el as HTMLInputElement).value;
}

const TRADE_REPUBLIC: Portfolio = {
  id: "p1",
  name: "Main",
  feeOrderFlat: 1,
  feeOrderFreeFrom: null,
  feeSavingsPlan: 0,
};

const FINANZEN_ZERO: Portfolio = {
  id: "p1",
  name: "Main",
  feeOrderFlat: 1,
  feeOrderFreeFrom: 500,
  feeSavingsPlan: 0,
};

// CRYPTO (not STOCK/ETF) so TransactionForm's live-price-refresh effect never
// fires and fetchLivePrice needs no mock — mirrors transaction-form.test.ts.
const cryptoAsset: Asset = {
  id: "asset1",
  isin: null,
  wkn: null,
  symbol: "BTC",
  name: "Bitcoin",
  type: "CRYPTO",
  currency: "EUR",
  notes: null,
};

afterEach(() => {
  cleanup();
  addAssetMock.mockClear();
  addTransactionMock.mockClear();
});

describe("AddAssetForm fee prefill (opening BUY)", () => {
  beforeEach(() => {
    portfolios = [TRADE_REPUBLIC];
  });

  it("prefills the flat order fee once quantity/price are entered", () => {
    render(createElement(AddAssetForm, { embedded: true }));
    fireEvent.click(screen.getByText("addAsset.orManual"));

    fireEvent.change(screen.getByLabelText("addAsset.quantity"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("addAsset.price"), { target: { value: "600" } });

    expect(val(screen.getByLabelText("addAsset.fee"))).toBe("1");
  });

  it("waives the fee at/above the free-from threshold, charges it below", () => {
    portfolios = [FINANZEN_ZERO];
    render(createElement(AddAssetForm, { embedded: true }));
    fireEvent.click(screen.getByText("addAsset.orManual"));

    fireEvent.change(screen.getByLabelText("addAsset.quantity"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("addAsset.price"), { target: { value: "600" } });
    expect(val(screen.getByLabelText("addAsset.fee"))).toBe("0");

    fireEvent.change(screen.getByLabelText("addAsset.price"), { target: { value: "400" } });
    expect(val(screen.getByLabelText("addAsset.fee"))).toBe("1");
  });

  it("stops tracking the auto fee once the user edits it directly", () => {
    render(createElement(AddAssetForm, { embedded: true }));
    fireEvent.click(screen.getByText("addAsset.orManual"));

    fireEvent.change(screen.getByLabelText("addAsset.quantity"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("addAsset.price"), { target: { value: "600" } });
    expect(val(screen.getByLabelText("addAsset.fee"))).toBe("1");

    fireEvent.change(screen.getByLabelText("addAsset.fee"), { target: { value: "5" } });
    // Changing the volume afterwards must NOT clobber the manual value.
    fireEvent.change(screen.getByLabelText("addAsset.price"), { target: { value: "10000" } });
    expect(val(screen.getByLabelText("addAsset.fee"))).toBe("5");
  });

  it("books the prefilled fee on submit", async () => {
    render(createElement(AddAssetForm, { embedded: true }));
    fireEvent.click(screen.getByText("addAsset.orManual"));
    fireEvent.click(screen.getByText("assetType.CRYPTO"));

    fireEvent.change(screen.getByLabelText("addAsset.symbol"), { target: { value: "BTC" } });
    fireEvent.change(screen.getByLabelText("addAsset.quantity"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("addAsset.price"), { target: { value: "600" } });

    fireEvent.click(screen.getByText("addAsset.title"));

    await vi.waitFor(() => expect(addTransactionMock).toHaveBeenCalledTimes(1));
    const booked = addTransactionMock.mock.calls[0][0] as { fee: number };
    expect(booked.fee).toBe(1);
  });
});

describe("TransactionForm fee prefill (BUY/SELL)", () => {
  beforeEach(() => {
    portfolios = [TRADE_REPUBLIC];
  });

  // No id/htmlFor pairing on these inputs (unlike AddAssetForm) — select by
  // visible order instead: quantity, price, fee, tax (BUY on a non-cash
  // asset shows all four as text/decimal inputs).
  function feeInput(container: HTMLElement): HTMLInputElement {
    return within(container).getAllByRole("textbox")[2] as HTMLInputElement;
  }
  function quantityInput(container: HTMLElement): HTMLInputElement {
    return within(container).getAllByRole("textbox")[0] as HTMLInputElement;
  }
  function priceInput(container: HTMLElement): HTMLInputElement {
    return within(container).getAllByRole("textbox")[1] as HTMLInputElement;
  }

  it("prefills the flat order fee for a BUY once quantity/price are entered", () => {
    const { container } = render(createElement(TransactionForm, { asset: cryptoAsset }));
    fireEvent.change(quantityInput(container), { target: { value: "1" } });
    fireEvent.change(priceInput(container), { target: { value: "600" } });
    expect(val(feeInput(container))).toBe("1");
  });

  it("prefills the flat order fee for a SELL too", () => {
    const { container } = render(createElement(TransactionForm, { asset: cryptoAsset }));
    fireEvent.click(screen.getByText("tx.sell"));
    fireEvent.change(quantityInput(container), { target: { value: "1" } });
    fireEvent.change(priceInput(container), { target: { value: "600" } });
    expect(val(feeInput(container))).toBe("1");
  });

  it("never prefills a fee for a BOOKING", () => {
    const { container } = render(createElement(TransactionForm, { asset: cryptoAsset }));
    fireEvent.click(screen.getByText("tx.booking"));
    fireEvent.change(quantityInput(container), { target: { value: "1" } });
    expect(val(feeInput(container))).toBe("0");
  });

  it("stops tracking the auto fee once the user edits it directly", () => {
    const { container } = render(createElement(TransactionForm, { asset: cryptoAsset }));
    fireEvent.change(quantityInput(container), { target: { value: "1" } });
    fireEvent.change(priceInput(container), { target: { value: "600" } });
    expect(val(feeInput(container))).toBe("1");

    fireEvent.change(feeInput(container), { target: { value: "2.5" } });
    fireEvent.change(priceInput(container), { target: { value: "10000" } });
    expect(val(feeInput(container))).toBe("2.5");
  });
});
