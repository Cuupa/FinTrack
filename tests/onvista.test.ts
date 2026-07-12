// mapOnvistaType / mapOnvistaHits — pure mapping from onvista's raw search
// response into the app's InstrumentHit shape. Fixtures mirror the real
// captured response shapes documented in SEARCH_DESIGN.md §2 (BASF by
// name/WKN/ISIN, VWCE FUND+entitySubType ETF, Bitcoin CRYPTO, plus a BOND hit
// that must be dropped). No network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetForTests,
  encodeOnvistaQuoteId,
  mapOnvistaHits,
  mapOnvistaType,
  onvistaEodHistory,
  onvistaQuote,
  parseOnvistaQuoteId,
  resolveOnvistaInstrument,
} from "../lib/server/onvista";

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

// ---------------------------------------------------------------------------
// Pricing fallback (round 19): resolveOnvistaInstrument / onvistaQuote /
// onvistaEodHistory / the quote_id encode-parse pair. Fetch is fully mocked,
// no real network — same posture as tests/yahoo-throttle.test.ts.
// ---------------------------------------------------------------------------

function searchResp(list: unknown[]) {
  return new Response(JSON.stringify({ expires: 0, searchValue: "x", list }), { status: 200 });
}

// DE000A0S9GB0, Xetra-Gold ETC — Yahoo has no hits for it at all.
const XETRA_GOLD_HIT = {
  entityType: "DERIVATIVE",
  entitySubType: "ETC_ETN_CERTIFICATE",
  name: "Xetra Gold ETC",
  isin: "DE000A0S9GB0",
  wkn: "A0S9GB",
  symbol: "4GLD",
  entityValue: "18869269",
};

describe("encodeOnvistaQuoteId / parseOnvistaQuoteId", () => {
  it("round-trips a DERIVATIVE id", () => {
    const id = encodeOnvistaQuoteId("DERIVATIVE", "259197435");
    expect(id).toBe("DERIVATIVE:259197435");
    expect(parseOnvistaQuoteId(id)).toEqual({ entityType: "DERIVATIVE", entityValue: "259197435" });
  });

  it("round-trips a FUND id", () => {
    const id = encodeOnvistaQuoteId("FUND", "97249538");
    expect(parseOnvistaQuoteId(id)).toEqual({ entityType: "FUND", entityValue: "97249538" });
  });

  it("rejects malformed ids", () => {
    expect(parseOnvistaQuoteId("")).toBeNull();
    expect(parseOnvistaQuoteId("noColon")).toBeNull();
    expect(parseOnvistaQuoteId(":123")).toBeNull(); // empty entityType
    expect(parseOnvistaQuoteId("DERIVATIVE:")).toBeNull(); // empty entityValue
    expect(parseOnvistaQuoteId("DERIVATIVE:abc")).toBeNull(); // non-numeric entityValue
    expect(parseOnvistaQuoteId("DERIVATIVE:123:456")).toBeNull(); // extra colon -> non-numeric tail
    expect(parseOnvistaQuoteId("AAPL")).toBeNull(); // a yahoo-shaped id, not onvista's
  });
});

describe("resolveOnvistaInstrument", () => {
  beforeEach(() => {
    __resetForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetForTests();
  });

  it("resolves the hit whose ISIN matches the query exactly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResp([XETRA_GOLD_HIT]));
    vi.stubGlobal("fetch", fetchMock);

    const ref = await resolveOnvistaInstrument("DE000A0S9GB0");
    expect(ref).toEqual({
      entityType: "DERIVATIVE",
      entityValue: "18869269",
      name: "Xetra Gold ETC",
      isin: "DE000A0S9GB0",
      wkn: "A0S9GB",
    });
  });

  it("resolves by WKN too, case-insensitively", async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResp([XETRA_GOLD_HIT]));
    vi.stubGlobal("fetch", fetchMock);

    const ref = await resolveOnvistaInstrument("a0s9gb");
    expect(ref?.entityValue).toBe("18869269");
  });

  it("accepts any entityType (FUND, not just DERIVATIVE) as long as entityValue is numeric", async () => {
    const fund = {
      entityType: "FUND",
      name: "Capital Group New Perspective Fund (LUX) - Bd EUR DIS",
      isin: "LU1295551730",
      wkn: "A141QX",
      entityValue: "97249538",
    };
    const fetchMock = vi.fn().mockResolvedValue(searchResp([fund]));
    vi.stubGlobal("fetch", fetchMock);

    const ref = await resolveOnvistaInstrument("LU1295551730");
    expect(ref).toEqual({
      entityType: "FUND",
      entityValue: "97249538",
      name: "Capital Group New Perspective Fund (LUX) - Bd EUR DIS",
      isin: "LU1295551730",
      wkn: "A141QX",
    });
  });

  it("skips a hit whose isin/wkn don't match exactly and returns null", async () => {
    const unrelated = { ...XETRA_GOLD_HIT, isin: "DE0001234567", wkn: "OTHER1" };
    const fetchMock = vi.fn().mockResolvedValue(searchResp([unrelated]));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveOnvistaInstrument("DE000A0S9GB0")).toBeNull();
  });

  it("returns the first exact match, skipping non-matching hits ahead of it", async () => {
    const decoy = { ...XETRA_GOLD_HIT, isin: "DE0009999999", wkn: "DECOY1", entityValue: "1" };
    const fetchMock = vi.fn().mockResolvedValue(searchResp([decoy, XETRA_GOLD_HIT]));
    vi.stubGlobal("fetch", fetchMock);

    const ref = await resolveOnvistaInstrument("DE000A0S9GB0");
    expect(ref?.entityValue).toBe("18869269");
  });

  it("drops a hit with a non-numeric entityValue", async () => {
    const bad = { ...XETRA_GOLD_HIT, entityValue: "abc123" };
    const fetchMock = vi.fn().mockResolvedValue(searchResp([bad]));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveOnvistaInstrument("DE000A0S9GB0")).toBeNull();
  });

  it("returns null for an empty query without issuing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveOnvistaInstrument("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null and does not throw on a failed request or empty result (expired/delisted instrument)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResp([]));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveOnvistaInstrument("XS0460099756")).toBeNull();
  });

  it("returns null and does not throw on an HTTP error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveOnvistaInstrument("DE000A0S9GB0")).toBeNull();
  });
});

describe("onvistaQuote", () => {
  beforeEach(() => {
    __resetForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetForTests();
  });

  it("returns price + currency from a snapshot response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ quote: { last: 115.87, isoCurrency: "EUR" } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await onvistaQuote("DERIVATIVE", "18869269")).toEqual({ price: 115.87, currency: "EUR" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/instruments/DERIVATIVE/18869269/snapshot");
  });

  it("returns null for a non-positive or missing price", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ quote: { last: 0, isoCurrency: "EUR" } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await onvistaQuote("DERIVATIVE", "1")).toBeNull();
  });

  it("returns null on a failed request without throwing (expired instrument)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await onvistaQuote("DERIVATIVE", "999")).toBeNull();
  });
});

describe("onvistaEodHistory", () => {
  beforeEach(() => {
    __resetForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetForTests();
  });

  it("maps parallel arrays into points, unix seconds -> UTC date", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          datetimeLast: [1781265600, 1781524800, 1781611200],
          last: [113.98, 116.9, 116.63],
          isoCurrency: "EUR",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await onvistaEodHistory("DERIVATIVE", "18869269", "1Y");
    expect(result?.currency).toBe("EUR");
    expect(result?.points).toEqual([
      { date: "2026-06-12", close: 113.98 },
      { date: "2026-06-15", close: 116.9 },
      { date: "2026-06-16", close: 116.63 },
    ]);
    // "1Y" maps to onvista's "Y1" token.
    expect(String(fetchMock.mock.calls[0][0])).toContain("range=Y1");
  });

  it("skips null/NaN/non-positive closes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          datetimeLast: [1000, 2000, 3000, 4000],
          last: [10, null, NaN, -5],
          isoCurrency: "EUR",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await onvistaEodHistory("FUND", "1", "MAX");
    expect(result?.points).toEqual([{ date: "1970-01-01", close: 10 }]);
  });

  it("maps app ranges to onvista's range tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ datetimeLast: [1000], last: [1], isoCurrency: "EUR" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await onvistaEodHistory("DERIVATIVE", "1", "1W");
    expect(String(fetchMock.mock.calls[0][0])).toContain("range=W1");

    fetchMock.mockClear();
    await onvistaEodHistory("DERIVATIVE", "1", "MAX");
    expect(String(fetchMock.mock.calls[0][0])).toContain("range=MAX");
  });

  it("returns null when the response has no usable points", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ datetimeLast: [], last: [], isoCurrency: "EUR" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await onvistaEodHistory("DERIVATIVE", "1", "1Y")).toBeNull();
  });

  it("returns null on a failed request without throwing (expired instrument)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await onvistaEodHistory("DERIVATIVE", "1", "1Y")).toBeNull();
  });
});
