// normalizeSecurityName strips German broker/exchange descriptor noise from
// CSV security names so they work as Yahoo search fallback queries.

import { describe, expect, it } from "vitest";
import { normalizeSecurityName } from "../lib/server/yahoo";

describe("normalizeSecurityName", () => {
  it("strips share-class + par-value noise (ZERO broker Alphabet name)", () => {
    expect(normalizeSecurityName("ALPHABET INC.CL.A DL-,001")).toBe("ALPHABET INC");
  });

  it("strips 'ohne Nennwert' descriptor", () => {
    expect(normalizeSecurityName("BASF SE O.N.")).toBe("BASF SE");
  });

  it("strips Inhaber-Aktien descriptor", () => {
    expect(normalizeSecurityName("SIEMENS AG INH. O.N.")).toBe("SIEMENS AG");
  });

  it("strips Vorzugsaktien descriptor", () => {
    expect(normalizeSecurityName("VOLKSWAGEN AG VZO O.N.")).toBe("VOLKSWAGEN AG");
  });

  it("strips ADR ratio tails", () => {
    expect(normalizeSecurityName("ALIBABA GR.HLDG ADR/8 DL-,000025")).toBe("ALIBABA GR.HLDG");
  });

  it("keeps clean fund names intact (enough tokens to search)", () => {
    expect(normalizeSecurityName("VANGUARD FTSE ALL-WORLD U.ETF")).toBe(
      "VANGUARD FTSE ALL-WORLD U.ETF",
    );
  });

  it("keeps plain company names unchanged", () => {
    expect(normalizeSecurityName("Apple Inc.")).toBe("Apple Inc.");
  });

  it("cuts registered-share + Nennwert descriptors and collapses whitespace", () => {
    expect(normalizeSecurityName("MERCEDES-BENZ GR.NAM. O.N.")).toBe("MERCEDES-BENZ GR.NAM."); // " O.N" cut
    expect(normalizeSecurityName("DEUTSCHE   TELEKOM AG")).toBe("DEUTSCHE TELEKOM AG");
  });
});
