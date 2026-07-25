import { describe, expect, it } from "vitest";
import { CORE_INSURANCE_TYPES, coverageGaps } from "@/lib/finance/insurance";
import type { Contract } from "@/lib/types";

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "c1",
    name: "Policy",
    amount: 10,
    interval: "MONTHLY",
    renewalDate: null,
    cancellationNoticeDays: null,
    categoryId: null,
    insuranceType: null,
    sumInsured: null,
    ...overrides,
  };
}

describe("coverageGaps", () => {
  it("flags every core type as a gap when there are no contracts", () => {
    expect(coverageGaps([])).toEqual(CORE_INSURANCE_TYPES);
  });

  it("flags every core type when contracts exist but none are typed as insurance", () => {
    const c = contract({ insuranceType: null });
    expect(coverageGaps([c])).toEqual(CORE_INSURANCE_TYPES);
  });

  it("removes a type once a contract carries it", () => {
    const c = contract({ insuranceType: "liability" });
    const gaps = coverageGaps([c]);
    expect(gaps).not.toContain("liability");
    expect(gaps).toEqual(CORE_INSURANCE_TYPES.filter((t) => t !== "liability"));
  });

  it("returns an empty list once every core type is covered", () => {
    const contracts = CORE_INSURANCE_TYPES.map((t, i) => contract({ id: `c${i}`, insuranceType: t }));
    expect(coverageGaps(contracts)).toEqual([]);
  });

  it("ignores non-core insurance types (e.g. vehicle) for gap detection", () => {
    const c = contract({ insuranceType: "vehicle" });
    expect(coverageGaps([c])).toEqual(CORE_INSURANCE_TYPES);
  });
});
