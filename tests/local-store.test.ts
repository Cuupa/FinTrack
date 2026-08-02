// Guest Mode storage-quota handling (PROD_READY.md "Guest portfolio write can
// throw and lose data"): LocalStore.write() must never let a quota failure
// crash uncaught, nor silently swallow it, it tags the error so callers know
// the mutation did not persist. See lib/store/errors.ts.

import { describe, expect, it } from "vitest";
import { LocalStore } from "../lib/store/local-store";
import { isStorageFullError, StorageFullError } from "../lib/store/errors";
import type { LlmConfig } from "../lib/types";

const ASSET_INPUT = {
  isin: "US0378331005",
  wkn: null,
  symbol: null,
  name: "Apple Inc.",
  type: "STOCK" as const,
  currency: "USD",
  notes: null,
};

/** In-memory Storage stub whose setItem always throws a given error. */
function makeThrowingStorage(err: unknown): Storage {
  return {
    getItem: () => null,
    setItem: () => {
      throw err;
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    get length() {
      return 0;
    },
  } as Storage;
}

/** In-memory Storage stub whose setItem succeeds `okCalls` times, then throws. */
function makeStorageThrowingAfter(okCalls: number, err: unknown): Storage {
  const map = new Map<string, string>();
  let calls = 0;
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      calls++;
      if (calls > okCalls) throw err;
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const QUOTA_EXCEEDED = () =>
  new DOMException("The quota has been exceeded.", "QuotaExceededError");
const LEGACY_QUOTA_EXCEEDED = () =>
  new DOMException("The quota has been exceeded.", "NS_ERROR_DOM_QUOTA_REACHED");

describe("LocalStore quota handling", () => {
  it("tags a QuotaExceededError as StorageFullError and rejects addAsset", async () => {
    const store = new LocalStore(makeThrowingStorage(QUOTA_EXCEEDED()));
    await expect(store.addAsset(ASSET_INPUT)).rejects.toSatisfy(isStorageFullError);
  });

  it("recognises the legacy Firefox quota error name too", async () => {
    const store = new LocalStore(makeThrowingStorage(LEGACY_QUOTA_EXCEEDED()));
    await expect(store.addAsset(ASSET_INPUT)).rejects.toSatisfy(isStorageFullError);
  });

  it("recognises a quota DOMException identified only by legacy code 22", async () => {
    // Some engines report the quota failure via `code` rather than `name`.
    const err = new DOMException("quota", "SomeOtherName");
    Object.defineProperty(err, "code", { value: 22 });
    const store = new LocalStore(makeThrowingStorage(err));
    await expect(store.addAsset(ASSET_INPUT)).rejects.toSatisfy(isStorageFullError);
  });

  it("rethrows a non-quota error untagged", async () => {
    const boom = new Error("disk on fire");
    const store = new LocalStore(makeThrowingStorage(boom));
    await expect(store.addAsset(ASSET_INPUT)).rejects.toBe(boom);
    await expect(store.addAsset(ASSET_INPUT)).rejects.not.toSatisfy(isStorageFullError);
  });

  it("StorageFullError has a stable name distinct from a generic Error", () => {
    const err = new StorageFullError();
    expect(err.name).toBe("StorageFullError");
    expect(isStorageFullError(err)).toBe(true);
    expect(isStorageFullError(new Error("StorageFullError"))).toBe(false); // message text, not name
    expect(isStorageFullError(new Error("nope"))).toBe(false);
    expect(isStorageFullError(null)).toBe(false);
  });

  it("leaves the previously-persisted data untouched after a failed write", async () => {
    const storage = makeStorageThrowingAfter(1, QUOTA_EXCEEDED());
    const store = new LocalStore(storage);
    const first = await store.addAsset(ASSET_INPUT);
    expect(first).toBeTruthy();

    // Second write throws (once-throwing stub); the add must reject and the
    // stored snapshot from the first successful write must be unchanged.
    const before = storage.getItem("fintrack:portfolio:v1");
    await expect(
      store.addAsset({ ...ASSET_INPUT, isin: "DE0007236101", name: "Siemens AG" }),
    ).rejects.toSatisfy(isStorageFullError);
    expect(storage.getItem("fintrack:portfolio:v1")).toBe(before);

    // A subsequent successful load only has the first asset.
    const data = await store.load();
    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].name).toBe("Apple Inc.");
  });
});

describe("LocalStore tag groups + assignments", () => {
  it("creates a group, replace-sets an asset's values, and reads them back via load()", async () => {
    const store = new LocalStore();
    const asset = await store.addAsset(ASSET_INPUT);
    const group = await store.addTagGroup("Strategie");

    await store.setAssetTags(asset.id, group.id, ["core", "gamble"]);
    let data = await store.load();
    expect(data.tagGroups).toEqual([group]);
    expect(data.tagAssignments).toEqual({ [asset.id]: { [group.id]: ["core", "gamble"] } });

    // Replace-set: a second call overwrites, doesn't append.
    await store.setAssetTags(asset.id, group.id, ["core"]);
    data = await store.load();
    expect(data.tagAssignments).toEqual({ [asset.id]: { [group.id]: ["core"] } });

    // An empty array clears the pair entirely.
    await store.setAssetTags(asset.id, group.id, []);
    data = await store.load();
    expect(data.tagAssignments).toEqual({});
  });

  it("renameTagGroup updates the name in place; blank name no-ops", async () => {
    const store = new LocalStore();
    const group = await store.addTagGroup("Strategie");

    await store.renameTagGroup(group.id, "Risiko");
    let data = await store.load();
    expect(data.tagGroups).toEqual([{ id: group.id, name: "Risiko" }]);

    await store.renameTagGroup(group.id, "   ");
    data = await store.load();
    expect(data.tagGroups).toEqual([{ id: group.id, name: "Risiko" }]);
  });

  it("deleteTagGroup drops the group and every assignment referencing it", async () => {
    const store = new LocalStore();
    const asset = await store.addAsset(ASSET_INPUT);
    const group = await store.addTagGroup("Strategie");
    await store.setAssetTags(asset.id, group.id, ["core"]);

    await store.deleteTagGroup(group.id);
    const data = await store.load();
    expect(data.tagGroups).toEqual([]);
    expect(data.tagAssignments).toEqual({});
  });

  it("deleteAsset cascades away that asset's tag assignments", async () => {
    const store = new LocalStore();
    const asset = await store.addAsset(ASSET_INPUT);
    const group = await store.addTagGroup("Strategie");
    await store.setAssetTags(asset.id, group.id, ["core"]);

    await store.deleteAsset(asset.id);
    const data = await store.load();
    // The group itself survives — only the assignment referencing the
    // deleted asset is gone.
    expect(data.tagGroups).toEqual([group]);
    expect(data.tagAssignments).toEqual({});
  });
});

describe("LocalStore llmConfig", () => {
  const SAMPLE: LlmConfig = { provider: "anthropic", model: "claude-sonnet-5", key: "sk-test" };

  it("defaults to null when nothing is stored", async () => {
    const store = new LocalStore();
    const data = await store.load();
    expect(data.llmConfig).toBeNull();
  });

  it("round-trips a saved config via load()", async () => {
    const store = new LocalStore();
    await store.saveLlmConfig(SAMPLE);
    const data = await store.load();
    expect(data.llmConfig).toEqual(SAMPLE);
  });

  it("replace-set: a second save overwrites, doesn't merge", async () => {
    const store = new LocalStore();
    await store.saveLlmConfig(SAMPLE);
    const next: LlmConfig = { provider: "openai", model: "gpt-5", key: "sk-other" };
    await store.saveLlmConfig(next);
    const data = await store.load();
    expect(data.llmConfig).toEqual(next);
  });

  it("saving null removes the config", async () => {
    const store = new LocalStore();
    await store.saveLlmConfig(SAMPLE);
    await store.saveLlmConfig(null);
    const data = await store.load();
    expect(data.llmConfig).toBeNull();
  });

  it("backfills a blob persisted before llmConfig existed to null", async () => {
    const storage = (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        get length() {
          return map.size;
        },
      } as Storage;
    })();
    // A pre-llmConfig blob: everything else present, no `llmConfig` key at all.
    storage.setItem(
      "fintrack:portfolio:v1",
      JSON.stringify({
        profile: { currency: "EUR" },
        portfolios: [{ id: "p1", name: "Main" }],
        assets: [],
        transactions: [],
        watchlist: [],
        savingsPlans: [],
        tagGroups: [],
        tagAssignments: {},
      }),
    );
    const store = new LocalStore(storage);
    const data = await store.load();
    expect(data.llmConfig).toBeNull();
  });
});

describe("LocalStore pension premiums", () => {
  it("records a premium and its cursor together, and makes a retry harmless", async () => {
    const store = new LocalStore();
    const policy = await store.addPensionContract({
      name: "Allianz",
      kind: "private",
      provider: null,
      monthlyContribution: 150,
      currentValue: null,
      expectedMonthlyPension: null,
      rentenfaktor: null,
      contributionDynamicPct: null,
      expectedReturnPct: null,
      startsOn: null,
      accountId: "account-1",
      bookingStartDate: "2026-01-15",
      lastBookedDate: null,
      note: null,
    });
    const premium = {
      accountId: "account-1",
      categoryId: null,
      date: "2026-01-15",
      amount: -150,
      payee: "Allianz",
      note: null,
      recurringId: null,
      pensionContractId: policy.id,
    };

    const first = await store.addSpendingTransaction(premium);
    const retry = await store.addSpendingTransaction(premium);
    const data = await store.load();

    expect(retry.id).toBe(first.id);
    expect(data.spendingTransactions).toHaveLength(1);
    expect(data.pensionContracts[0]?.lastBookedDate).toBe("2026-01-15");
  });

  it("moves a cursor that a half-finished booking left behind", async () => {
    // The state this whole change exists to prevent: the row was written but
    // the cursor never advanced. Recognising the row and stopping there would
    // leave that premium due forever, with no way left to clear it.
    const store = new LocalStore();
    const policy = await store.addPensionContract({
      name: "Allianz",
      kind: "private",
      provider: null,
      monthlyContribution: 150,
      currentValue: null,
      expectedMonthlyPension: null,
      rentenfaktor: null,
      contributionDynamicPct: null,
      expectedReturnPct: null,
      startsOn: null,
      accountId: "account-1",
      bookingStartDate: "2026-01-15",
      lastBookedDate: null,
      note: null,
    });
    const premium = {
      accountId: "account-1",
      categoryId: null,
      date: "2026-01-15",
      amount: -150,
      payee: "Allianz",
      note: null,
      recurringId: null,
      pensionContractId: policy.id,
    };
    await store.addSpendingTransaction(premium);
    await store.updatePensionContract(policy.id, { lastBookedDate: null });

    await store.addSpendingTransaction(premium);
    const data = await store.load();

    expect(data.spendingTransactions).toHaveLength(1);
    expect(data.pensionContracts[0]?.lastBookedDate).toBe("2026-01-15");
  });

  it("never moves the cursor backwards onto an older occurrence", async () => {
    const store = new LocalStore();
    const policy = await store.addPensionContract({
      name: "Allianz",
      kind: "private",
      provider: null,
      monthlyContribution: 150,
      currentValue: null,
      expectedMonthlyPension: null,
      rentenfaktor: null,
      contributionDynamicPct: null,
      expectedReturnPct: null,
      startsOn: null,
      accountId: "account-1",
      bookingStartDate: "2026-01-15",
      lastBookedDate: null,
      note: null,
    });
    const premium = (date: string) => ({
      accountId: "account-1",
      categoryId: null,
      date,
      amount: -150,
      payee: "Allianz",
      note: null,
      recurringId: null,
      pensionContractId: policy.id,
    });

    await store.addSpendingTransaction(premium("2026-02-15"));
    await store.addSpendingTransaction(premium("2026-01-15"));
    const data = await store.load();

    expect(data.spendingTransactions).toHaveLength(2);
    expect(data.pensionContracts[0]?.lastBookedDate).toBe("2026-02-15");
  });

  it("keeps an old booking but removes its policy link when the policy is deleted", async () => {
    const store = new LocalStore();
    const policy = await store.addPensionContract({
      name: "Allianz",
      kind: "private",
      provider: null,
      monthlyContribution: 150,
      currentValue: null,
      expectedMonthlyPension: null,
      rentenfaktor: null,
      contributionDynamicPct: null,
      expectedReturnPct: null,
      startsOn: null,
      accountId: "account-1",
      bookingStartDate: "2026-01-15",
      lastBookedDate: null,
      note: null,
    });
    await store.addSpendingTransaction({
      accountId: "account-1",
      categoryId: null,
      date: "2026-01-15",
      amount: -150,
      payee: "Allianz",
      note: null,
      recurringId: null,
      pensionContractId: policy.id,
    });

    await store.deletePensionContract(policy.id);
    const data = await store.load();
    expect(data.spendingTransactions[0]?.pensionContractId).toBeNull();
  });
});

// Same class of bug on the savings plan, with worse consequences: a repeated
// confirmation used to buy the same units a second time, because `transactions`
// had no link back to the plan to recognise the BUY by (migration 0123).
describe("LocalStore savings-plan occurrences", () => {
  const plan = (over: Partial<Parameters<LocalStore["addSavingsPlan"]>[0]> = {}) => ({
    assetId: "asset-1",
    portfolioId: "pf-1",
    amount: 250,
    interval: "MONTHLY" as const,
    startDate: "2026-01-05",
    active: true,
    lastRunDate: null,
    accountId: "acc-1",
    ...over,
  });
  const buy = (planId: string, date: string) => ({
    assetId: "asset-1",
    portfolioId: "pf-1",
    type: "BUY" as const,
    quantity: 2,
    price: 125,
    fee: 0,
    tax: 0,
    date: `${date}T00:00:00`,
    savingsPlanId: planId,
  });

  it("books the BUY and the plan's cursor together, and makes a retry harmless", async () => {
    const store = new LocalStore();
    const sp = await store.addSavingsPlan(plan());

    const first = await store.addTransaction(buy(sp.id, "2026-02-05"));
    const retry = await store.addTransaction(buy(sp.id, "2026-02-05"));
    const data = await store.load();

    expect(retry.id).toBe(first.id);
    expect(data.transactions).toHaveLength(1);
    expect(data.savingsPlans[0]?.lastRunDate).toBe("2026-02-05");
  });

  it("moves a cursor that a half-finished run left behind", async () => {
    const store = new LocalStore();
    const sp = await store.addSavingsPlan(plan());
    await store.addTransaction(buy(sp.id, "2026-02-05"));
    await store.updateSavingsPlan(sp.id, { lastRunDate: null });

    await store.addTransaction(buy(sp.id, "2026-02-05"));
    const data = await store.load();

    expect(data.transactions).toHaveLength(1);
    expect(data.savingsPlans[0]?.lastRunDate).toBe("2026-02-05");
  });

  it("still books a later occurrence of the same plan", async () => {
    // The dedupe is per occurrence, not per plan: March must not be swallowed
    // because February is already on the ledger.
    const store = new LocalStore();
    const sp = await store.addSavingsPlan(plan());

    await store.addTransaction(buy(sp.id, "2026-02-05"));
    await store.addTransaction(buy(sp.id, "2026-03-05"));
    const data = await store.load();

    expect(data.transactions).toHaveLength(2);
    expect(data.savingsPlans[0]?.lastRunDate).toBe("2026-03-05");
  });

  it("leaves a manual purchase of the same asset on the same day alone", async () => {
    const store = new LocalStore();
    const sp = await store.addSavingsPlan(plan());
    await store.addTransaction(buy(sp.id, "2026-02-05"));

    await store.addTransaction({ ...buy(sp.id, "2026-02-05"), quantity: 9, savingsPlanId: null });
    const data = await store.load();

    expect(data.transactions).toHaveLength(2);
  });

  it("keeps the debit on the Verrechnungskonto single too", async () => {
    const store = new LocalStore();
    const sp = await store.addSavingsPlan(plan());
    const debit = {
      accountId: "acc-1",
      categoryId: null,
      date: "2026-02-05",
      amount: -250,
      payee: "MSCI World",
      note: null,
      recurringId: null,
      savingsPlanId: sp.id,
    };

    const first = await store.addSpendingTransaction(debit);
    const retry = await store.addSpendingTransaction(debit);
    const data = await store.load();

    expect(retry.id).toBe(first.id);
    expect(data.spendingTransactions).toHaveLength(1);
  });
});
