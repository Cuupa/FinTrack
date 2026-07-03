// mapOnvistaType / mapOnvistaHits — pure mapping from onvista's raw search
// response into the app's InstrumentHit shape. Fixtures mirror the real
// captured response shapes documented in SEARCH_DESIGN.md §2 (BASF by
// name/WKN/ISIN, VWCE FUND+entitySubType ETF, Bitcoin CRYPTO, plus a BOND hit
// that must be dropped). No network.

import { describe, expect, it } from "vitest";
import { mapOnvistaHits, mapOnvistaType } from "../lib/server/onvista";

const BASF_HIT = {
  entityType: "STOCK",
  name: "BASF",
  isin: "DE000BASF111",
  wkn: "BASF11",
  symbol: "BAS",
  homeSymbol: "BAS",
  displayType: "Aktie",
};

const VWCE_HIT = {
  entityType: "FUND",
  entitySubType: "ETF",
  name: "Vanguard FTSE All-World UCITS ETF USD Acc.",
  isin: "IE00BK5BQT80",
  wkn: "A2PKXG",
  symbol: "VWCE",
};

const BITCOIN_HIT = {
  entityType: "CRYPTO",
  name: "Bitcoin (BTC) Kurs in US Dollar",
  isin: "XC000A2YY636",
  wkn: "A2YY63",
  symbol: "",
};

const BOND_HIT = {
  entityType: "BOND",
  name: "Bundesrepublik Deutschland Anl. v. 2020 (2030)",
  isin: "DE0001102481",
  wkn: "110248",
  symbol: "",
};

describe("mapOnvistaType", () => {
  it("maps STOCK -> STOCK", () => {
    expect(mapOnvistaType("STOCK", undefined)).toBe("STOCK");
  });

  it("maps FUND (entitySubType ETF) -> ETF", () => {
    expect(mapOnvistaType("FUND", "ETF")).toBe("ETF");
  });

  it("maps FUND (no/other entitySubType) -> ETF (no mutual-fund type)", () => {
    expect(mapOnvistaType("FUND", undefined)).toBe("ETF");
    expect(mapOnvistaType("FUND", "MUTUAL_FUND")).toBe("ETF");
  });

  it("maps CRYPTO -> CRYPTO", () => {
    expect(mapOnvistaType("CRYPTO", undefined)).toBe("CRYPTO");
  });

  it("maps BOND (and anything unrecognized) -> null", () => {
    expect(mapOnvistaType("BOND", undefined)).toBeNull();
    expect(mapOnvistaType(undefined, undefined)).toBeNull();
  });
});

describe("mapOnvistaHits", () => {
  it("maps a BASF hit found by name search", () => {
    const hits = mapOnvistaHits({ expires: 0, searchValue: "BASF", list: [BASF_HIT] });
    expect(hits).toEqual([
      {
        isin: "DE000BASF111",
        wkn: "BASF11",
        symbol: "BAS",
        name: "BASF",
        type: "STOCK",
        currency: null,
        source: "onvista",
      },
    ]);
  });

  it("maps the same BASF hit whether found by WKN or ISIN query", () => {
    const byWkn = mapOnvistaHits({ expires: 0, searchValue: "BASF11", list: [BASF_HIT] });
    const byIsin = mapOnvistaHits({
      expires: 0,
      searchValue: "DE000BASF111",
      list: [BASF_HIT],
    });
    expect(byWkn).toEqual(byIsin);
    expect(byWkn[0].isin).toBe("DE000BASF111");
    expect(byWkn[0].wkn).toBe("BASF11");
  });

  it("maps VWCE as ETF via entityType FUND + entitySubType ETF", () => {
    const hits = mapOnvistaHits({ expires: 0, searchValue: "IE00BK5BQT80", list: [VWCE_HIT] });
    expect(hits).toEqual([
      {
        isin: "IE00BK5BQT80",
        wkn: "A2PKXG",
        symbol: "VWCE",
        name: "Vanguard FTSE All-World UCITS ETF USD Acc.",
        type: "ETF",
        currency: null,
        source: "onvista",
      },
    ]);
  });

  it("maps Bitcoin as CRYPTO but drops onvista's synthetic isin/wkn (not real security identifiers)", () => {
    const hits = mapOnvistaHits({ expires: 0, searchValue: "Bitcoin", list: [BITCOIN_HIT] });
    expect(hits).toEqual([
      {
        isin: null,
        wkn: null,
        symbol: null, // onvista's symbol was "" for this hit
        name: "Bitcoin (BTC) Kurs in US Dollar",
        type: "CRYPTO",
        currency: null,
        source: "onvista",
      },
    ]);
  });

  it("drops a BOND hit entirely (unsupported type)", () => {
    const hits = mapOnvistaHits({ expires: 0, searchValue: "Bundesanleihe", list: [BOND_HIT] });
    expect(hits).toEqual([]);
  });

  it("filters a BOND out of a mixed list while keeping supported hits", () => {
    const hits = mapOnvistaHits({
      expires: 0,
      searchValue: "mixed",
      list: [BASF_HIT, BOND_HIT, VWCE_HIT],
    });
    expect(hits.map((h) => h.name)).toEqual([BASF_HIT.name, VWCE_HIT.name]);
  });

  it("handles a missing/empty list gracefully", () => {
    expect(mapOnvistaHits({ expires: 0, searchValue: "x", list: [] })).toEqual([]);
    expect(mapOnvistaHits({})).toEqual([]);
    expect(mapOnvistaHits(null)).toEqual([]);
  });

  it("drops a hit with no name", () => {
    const hits = mapOnvistaHits({
      expires: 0,
      searchValue: "x",
      list: [{ ...BASF_HIT, name: "" }],
    });
    expect(hits).toEqual([]);
  });
});
