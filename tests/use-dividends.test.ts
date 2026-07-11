// @vitest-environment jsdom
//
// useDividends (lib/history/use-dividends.ts) loading transitions. `loading`
// is DERIVED from comparing the settled state's signature against the current
// one (same pattern as use-history.ts) rather than set synchronously in an
// effect (Next 16's react-hooks/set-state-in-effect lint rule fails the build
// on that). apiFetch is mocked so we control exactly when each fetch settles.

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDividends, type DividendMap } from "../lib/history/use-dividends";
import type { HistItem } from "../lib/history/history";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch: apiFetchMock }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The hook consumes this via `await` from inside its own try/catch once its
  // setTimeout(run, 0) fires, but that's a macrotask later than a synchronous
  // `.reject()` call in a test, attach a no-op catch now so Node doesn't
  // flag it as unhandled in the gap before the hook's own await attaches.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function okResponse(dividends: DividendMap) {
  return { ok: true, json: async () => ({ dividends }) } as Response;
}

const itemA: HistItem = { key: "A", source: "yahoo", id: "A", currency: "EUR" };
const itemB: HistItem = { key: "B", source: "yahoo", id: "B", currency: "EUR" };

describe("useDividends", () => {
  it("reports loading:false and an empty map when there are no items to fetch", () => {
    const { result } = renderHook(() => useDividends([]));
    expect(result.current.loading).toBe(false);
    expect(result.current.dividends).toEqual({});
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("is loading while the fetch for the current signature is in flight", async () => {
    const d = deferred<Response>();
    apiFetchMock.mockReturnValueOnce(d.promise);

    const { result } = renderHook(() => useDividends([itemA]));

    expect(result.current.loading).toBe(true);
    expect(result.current.dividends).toEqual({});

    // Settle so the test doesn't leak a pending timer/promise.
    d.resolve(okResponse({}));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("settles to loading:false with the fetched map once the response lands", async () => {
    const mapA: DividendMap = { A: [{ date: "2026-01-01", amount: 1.5 }] };
    const d = deferred<Response>();
    apiFetchMock.mockReturnValueOnce(d.promise);

    const { result } = renderHook(() => useDividends([itemA]));
    expect(result.current.loading).toBe(true);

    d.resolve(okResponse(mapA));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dividends).toEqual(mapA);
  });

  it("goes back to loading:true when the signature changes, keeping the previous map visible", async () => {
    const mapA: DividendMap = { A: [{ date: "2026-01-01", amount: 1.5 }] };
    const mapB: DividendMap = { B: [{ date: "2026-02-01", amount: 2.5 }] };

    const dA = deferred<Response>();
    apiFetchMock.mockReturnValueOnce(dA.promise);
    const { result, rerender } = renderHook(({ items }) => useDividends(items), {
      initialProps: { items: [itemA] },
    });
    dA.resolve(okResponse(mapA));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dividends).toEqual(mapA);

    const dB = deferred<Response>();
    apiFetchMock.mockReturnValueOnce(dB.promise);
    rerender({ items: [itemB] });

    // Loading flips true immediately on the sig change, and the stale map
    // from itemA stays visible while itemB's fetch is in flight.
    expect(result.current.loading).toBe(true);
    expect(result.current.dividends).toEqual(mapA);

    dB.resolve(okResponse(mapB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dividends).toEqual(mapB);
  });

  it("on error, settles to loading:false and keeps the previous map", async () => {
    const mapA: DividendMap = { A: [{ date: "2026-01-01", amount: 1.5 }] };

    const dA = deferred<Response>();
    apiFetchMock.mockReturnValueOnce(dA.promise);
    const { result, rerender } = renderHook(({ items }) => useDividends(items), {
      initialProps: { items: [itemA] },
    });
    dA.resolve(okResponse(mapA));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dividends).toEqual(mapA);

    const dB = deferred<Response>();
    apiFetchMock.mockReturnValueOnce(dB.promise);
    rerender({ items: [itemB] });
    expect(result.current.loading).toBe(true);

    dB.reject(new Error("network down"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dividends).toEqual(mapA);
  });
});
