// Rate-limit protection in lib/server/yahoo.ts: the shared concurrency
// throttle, the TTL cache helper, and getJSON's 429/503 retry + circuit
// breaker. No real network — fetch is fully mocked via vi.stubGlobal, and
// backoff sleeps are driven with fake timers so nothing here is flaky.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConcurrencyLimiter, TTLCache, __resetForTests, dividendsByQuery, getJSON } from "../lib/server/yahoo";

describe("ConcurrencyLimiter", () => {
  it("caps concurrent acquisitions at max and drains the FIFO queue in order", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const order: number[] = [];
    let active = 0;
    let maxActive = 0;
    const releaseFns: Record<number, () => void> = {};

    function start(id: number): Promise<void> {
      return limiter.acquire().then((release) => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(id);
        releaseFns[id] = () => {
          active--;
          release();
        };
      });
    }

    const p1 = start(1);
    const p2 = start(2);
    await p1;
    await p2;
    expect(active).toBe(2);
    expect(order).toEqual([1, 2]);

    // Two more tasks arrive while the limiter is full — they must queue, not run.
    const p3 = start(3);
    const p4 = start(4);
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2);
    expect(order).toEqual([1, 2]);

    releaseFns[1]();
    await p3;
    expect(order).toEqual([1, 2, 3]);
    expect(active).toBe(2);

    releaseFns[2]();
    await p4;
    expect(order).toEqual([1, 2, 3, 4]);
    expect(maxActive).toBe(2);
  });
});

describe("TTLCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves a cached value until its TTL elapses, then misses", () => {
    const cache = new TTLCache<number>(10);
    cache.set("a", 1, 1000);
    expect(cache.get("a")).toBe(1);
    vi.advanceTimersByTime(999);
    expect(cache.get("a")).toBe(1);
    vi.advanceTimersByTime(2);
    expect(cache.get("a")).toBeUndefined();
  });

  it("caches a negative (null) result distinctly from an absent key", () => {
    const cache = new TTLCache<number | null>(10);
    expect(cache.get("x")).toBeUndefined();
    cache.set("x", null, 1000);
    expect(cache.get("x")).toBeNull();
  });

  it("evicts the oldest entry once maxEntries is exceeded", () => {
    const cache = new TTLCache<number>(2);
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);
    cache.set("c", 3, 60_000); // over capacity — evicts "a" (oldest)
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });
});

describe("getJSON: 429/503 retry + circuit breaker", () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    __resetForTests();
  });

  it("retries a 429 with backoff and returns the JSON once a retry succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = getJSON("https://example.test/x");
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors a sane Retry-After header, capped at the max backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = getJSON("https://example.test/x");
    await vi.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries on 429 and opens the circuit breaker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = getJSON("https://example.test/x");
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(first).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial attempt + 2 retries

    // Cooldown is now active: the next call must short-circuit without hitting fetch.
    fetchMock.mockClear();
    await expect(getJSON("https://example.test/y")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    // Once the cooldown (45s) elapses, the breaker closes again.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await vi.advanceTimersByTimeAsync(46_000);
    await expect(getJSON("https://example.test/z")).resolves.toEqual({ ok: true });
  });

  it("does not retry or open the circuit breaker on a network error/timeout", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getJSON("https://example.test/x")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Breaker must still be closed — the next call reaches the network again.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(getJSON("https://example.test/y")).resolves.toEqual({ ok: true });
  });

  it("does not retry a plain 404 and does not open the circuit breaker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getJSON("https://example.test/x")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("dividendsByQuery", () => {
  beforeEach(() => {
    __resetForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetForTests();
  });

  function chartResponse(currency: string, dividends?: Record<string, { amount: number; date: number }>) {
    return new Response(
      JSON.stringify({
        chart: { result: [{ meta: { currency }, events: dividends ? { dividends } : {} }] },
      }),
      { status: 200 },
    );
  }

  it("trusts the hinted listing's empty event list and fetches nothing else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chartResponse("EUR"));
    vi.stubGlobal("fetch", fetchMock);

    // XAUEUR=X: gold's real Yahoo listing, which never pays dividends.
    const result = await dividendsByQuery("XAU", "EUR", "XAUEUR=X", "5y", "Gold");
    expect(result).toEqual({ events: [], currency: "EUR" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/chart/XAUEUR%3DX");
  });

  it("returns the hinted listing's real events when it has them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chartResponse("USD", { "1": { amount: 0.5, date: 1700000000 } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await dividendsByQuery("US0000000000", "USD", "AAPL", "5y");
    expect(result?.currency).toBe("USD");
    expect(result?.events).toEqual([{ date: "2023-11-14", amount: 0.5 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls through to the search-candidate loop when the hint does not resolve", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/chart/BADHINT")) return Promise.resolve(new Response(null, { status: 404 }));
      if (u.includes("/v1/finance/search")) {
        return Promise.resolve(new Response(JSON.stringify({ quotes: [{ symbol: "REAL.DE" }] }), { status: 200 }));
      }
      if (u.includes("/chart/REAL.DE")) {
        return Promise.resolve(chartResponse("EUR", { "1": { amount: 1.2, date: 1700000000 } }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await dividendsByQuery("DE0000000000", "EUR", "BADHINT", "5y", "Real Corp");
    expect(result?.currency).toBe("EUR");
    expect(result?.events).toEqual([{ date: "2023-11-14", amount: 1.2 }]);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/chart/BADHINT"))).toBe(true);
    expect(urls.some((u) => u.includes("/v1/finance/search"))).toBe(true);
    expect(urls.some((u) => u.includes("/chart/REAL.DE"))).toBe(true);
  });

  it("with no hint, scans search candidates as before", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/v1/finance/search")) {
        return Promise.resolve(new Response(JSON.stringify({ quotes: [{ symbol: "REAL.DE" }] }), { status: 200 }));
      }
      if (u.includes("/chart/REAL.DE")) {
        return Promise.resolve(chartResponse("EUR", { "1": { amount: 1.2, date: 1700000000 } }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await dividendsByQuery("DE0000000000", "EUR", undefined, "5y", "Real Corp");
    expect(result?.currency).toBe("EUR");
    expect(result?.events).toEqual([{ date: "2023-11-14", amount: 1.2 }]);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/chart/BADHINT"))).toBe(false);
    expect(urls.some((u) => u.includes("/v1/finance/search"))).toBe(true);
  });
});
