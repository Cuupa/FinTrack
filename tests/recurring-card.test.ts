// @vitest-environment jsdom

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { emptyPortfolio } from "../lib/types";
import { RecurringCard } from "../components/spending/recurring-card";

const mocks = vi.hoisted(() => ({
  data: null as ReturnType<typeof emptyPortfolio> | null,
  addSpendingTransaction: vi.fn(async () => ({ id: "tx-1" })),
  updatePlannedCashflow: vi.fn(async () => undefined),
}));

vi.mock("@/lib/finance/dates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/finance/dates")>()),
  today: () => "2026-08-04",
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/portfolio/portfolio-context", () => ({
  usePortfolio: () => ({
    data: mocks.data,
    addSpendingTransaction: mocks.addSpendingTransaction,
    updateSpendingTransaction: vi.fn(),
    addContract: vi.fn(),
    updateContract: vi.fn(),
    deleteContract: vi.fn(),
    updatePlannedCashflow: mocks.updatePlannedCashflow,
    deletePlannedCashflow: vi.fn(),
  }),
}));

vi.mock("@/lib/accounts/use-account-movements", () => ({
  useAccountMovements: () => new Map(),
}));

vi.mock("@/lib/flags/flags-context", () => ({
  useFeature: () => ({ enabled: true, locked: false }),
}));

vi.mock("@/lib/i18n/i18n-context", () => ({
  useI18n: () => ({ locale: "en", setLocale: vi.fn(), t: (key: string) => key }),
}));

describe("RecurringCard due-entry review", () => {
  beforeEach(() => {
    const data = emptyPortfolio();
    data.accounts.push({
      id: "cash-1",
      name: "Current account",
      kind: "checking",
      currency: "EUR",
      isLiability: false,
      openingBalance: 0,
      openedOn: "2026-01-01",
    });
    data.plannedCashflows.push({
      id: "plan-1",
      name: "Rent",
      accountId: "cash-1",
      categoryId: null,
      amount: -100,
      interval: "ONCE",
      startDate: "2026-08-01",
      endDate: null,
      lastBookedDate: null,
      transferAccountId: null,
      note: null,
    });
    mocks.data = data;
    mocks.addSpendingTransaction.mockClear();
    mocks.updatePlannedCashflow.mockClear();
  });

  afterEach(cleanup);

  it("chooses occurrence or today per row and only exposes amount editing through the pencil", async () => {
    render(createElement(RecurringCard));

    expect(screen.queryByRole("textbox", { name: "recurring.due.amountLabel" })).toBeNull();
    const dateGroup = screen.getByRole("group", { name: "recurring.due.dateLabel" });
    expect(dateGroup.querySelector('button[aria-pressed="true"]')?.textContent).toContain(
      "recurring.due.occurrence",
    );

    fireEvent.click(screen.getByRole("button", { name: "recurring.due.today" }));
    expect(
      screen.getByRole("button", { name: "recurring.due.today" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "recurring.due.editAmount" }));
    const amount = screen.getByRole("textbox", { name: "recurring.due.amountLabel" });
    fireEvent.change(amount, { target: { value: "0" } });
    expect(
      (screen.getByRole("button", { name: "recurring.due.book" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(amount, { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "recurring.due.book" }));

    await waitFor(() => expect(mocks.addSpendingTransaction).toHaveBeenCalledTimes(1));
    expect(mocks.addSpendingTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-08-04", amount: -75 }),
    );
    await waitFor(() =>
      expect(mocks.updatePlannedCashflow).toHaveBeenCalledWith("plan-1", {
        lastBookedDate: "2026-08-01",
      }),
    );
  });
});
