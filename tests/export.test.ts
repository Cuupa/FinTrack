import { describe, expect, it } from "vitest";
import { portfolioToCsv, portfolioToJson } from "../lib/export/export";
import { emptyPortfolio, type PortfolioData } from "../lib/types";

// The export is the user's copy of their own data, so the thing worth pinning
// is coverage: every entity the app stores has a section, an entity they never
// used has none, and the one secret in PortfolioData never reaches the file.
//
// The Assets/Transactions round trip back through the importer lives in
// tests/import.test.ts, which is the other half of this contract.

function sample(): PortfolioData {
  const data = emptyPortfolio();
  return {
    ...data,
    profile: { ...data.profile, currency: "EUR" },
    portfolios: [{ id: "p1", name: "Trade Republic", taxAllowance: 1000 }],
    assets: [
      {
        id: "a1",
        isin: "US0378331005",
        wkn: null,
        symbol: null,
        name: "Apple Inc.",
        type: "STOCK",
        currency: "USD",
        notes: null,
      },
    ],
    accounts: [
      {
        id: "acc1",
        name: "Girokonto",
        kind: "checking",
        currency: "EUR",
        isLiability: false,
        openingBalance: 2500,
        openedOn: "2024-01-01",
      },
      {
        id: "acc2",
        name: "Baukredit",
        kind: "loan",
        currency: "EUR",
        isLiability: true,
        openingBalance: 180000,
        openedOn: "2023-06-01",
        interestRate: 3.4,
        rateFixedUntil: "2033-06-01",
        followUpRate: 5,
      },
    ],
    accountBalances: [{ accountId: "acc1", date: "2026-07-01", balance: 2712.5 }],
    spendingCategories: [
      { id: "c1", groupName: "Wohnen", name: "Miete" },
      { id: "c2", groupName: "Essen", name: "Supermarkt" },
    ],
    spendingTransactions: [
      {
        id: "s1",
        accountId: "acc1",
        categoryId: "c1",
        date: "2026-07-01",
        amount: -1200,
        payee: "Vermieter",
        note: null,
        recurringId: null,
      },
      {
        id: "s2",
        accountId: "acc1",
        categoryId: null,
        date: "2026-07-03",
        amount: -500,
        payee: "Sondertilgung",
        note: null,
        recurringId: null,
        transferAccountId: "acc2",
      },
    ],
    budgets: [{ id: "b1", categoryId: "c2", amount: 400 }],
    goals: [
      {
        id: "g1",
        name: "Notgroschen",
        targetAmount: 10000,
        targetDate: "2027-12-31",
        linkedAccountId: "acc1",
        manualCurrentAmount: null,
        tracksInvestments: false,
        linkedPortfolioId: null,
        linkedAssetId: null,
        parentGoalId: null,
      },
    ],
    pensionPoints: [{ year: 2025, points: 1.25, note: null }],
    tagGroups: [{ id: "tg1", name: "Strategie" }],
    tagAssignments: { a1: { tg1: ["Kern"] } },
  };
}

describe("portfolioToCsv", () => {
  it("writes a section for every entity the user actually has", () => {
    const csv = portfolioToCsv(sample());
    for (const heading of [
      "# Assets",
      "# Transactions",
      "# Brokers",
      "# Tags",
      "# Accounts",
      "# Account balances",
      "# Spending categories",
      "# Bookings",
      "# Budgets",
      "# Goals",
      "# Pension points",
    ]) {
      expect(csv).toContain(heading);
    }
  });

  it("leaves out a section the user has no rows for", () => {
    const csv = portfolioToCsv(sample());
    // Nothing on the watchlist, no savings plan, no policy, no recurring
    // payment: a lone header would claim those features were looked at.
    expect(csv).not.toContain("# Watchlist");
    expect(csv).not.toContain("# Savings plans");
    expect(csv).not.toContain("# Pension policies");
    expect(csv).not.toContain("# Recurring payments");
    expect(csv).not.toContain("# Planned income & expenses");
  });

  it("resolves cross-references to names rather than exporting raw ids", () => {
    const csv = portfolioToCsv(sample());
    // A booking names its account, its category and its transfer target.
    expect(csv).toContain("Girokonto,Wohnen · Miete,Vermieter,-1200");
    expect(csv).toContain("Sondertilgung,-500,Baukredit");
    // A goal names the account it is linked to.
    expect(csv).toContain("Notgroschen,10000,2027-12-31,,Girokonto");
    // A tag reads as asset/group/value.
    expect(csv).toContain("Apple Inc.,Strategie,Kern");
  });

  it("keeps a liability's full rate schedule, not just today's rate", () => {
    const csv = portfolioToCsv(sample());
    expect(csv).toContain("Baukredit,loan,EUR,true,180000,2023-06-01,3.4,,,2033-06-01,5");
  });

  it("quotes a field containing the separator", () => {
    const data = sample();
    data.accounts[0].name = "Giro, gemeinsam";
    expect(portfolioToCsv(data)).toContain('"Giro, gemeinsam"');
  });
});

describe("portfolioToJson", () => {
  it("never writes the user's own API key into the downloaded file", () => {
    const data = sample();
    data.llmConfig = { provider: "anthropic", model: "claude-opus-5", key: "sk-ant-SECRET" };
    const json = portfolioToJson(data);
    expect(json).not.toContain("sk-ant-SECRET");
    // Nulled rather than dropped: "no key configured" is a state the app has,
    // a missing field is not.
    expect(JSON.parse(json).data.llmConfig).toBeNull();
  });

  it("carries the everyday-money entities the CSV also covers", () => {
    const parsed = JSON.parse(portfolioToJson(sample()));
    expect(parsed.data.accounts).toHaveLength(2);
    expect(parsed.data.spendingTransactions).toHaveLength(2);
    expect(parsed.data.goals[0].name).toBe("Notgroschen");
    expect(parsed.data.tagAssignments.a1.tg1).toEqual(["Kern"]);
  });
});
