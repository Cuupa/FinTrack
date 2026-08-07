"use client";

// Running the Monte Carlo, once, for everyone who runs it.
//
// /simulation and the FIRE planner had grown two copies of the same machinery:
// the FNV-1a param hash, the Web Crypto seed, the cache read, the worker
// construction, the 4-second watchdog, the main-thread fallback and the cache
// write. Two copies of a cache key is the dangerous half -- they hashed
// different field sets, so the two pages could not reuse each other's stored
// runs, and adding a parameter to one silently left the other returning a
// stale result for changed inputs.
//
// The engine itself was always shared (lib/finance/monte-carlo.ts); this is the
// orchestration around it.

import { useEffect, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import {
  runMonteCarlo,
  runPortfolioMonteCarlo,
  type MonteCarloParams,
  type MonteCarloResult,
  type PortfolioMonteCarloParams,
} from "@/lib/finance/monte-carlo";

/** What gets posted to the worker: the engine to use, and its parameters. */
export type SimulationMessage =
  | { kind: "portfolio"; params: PortfolioMonteCarloParams }
  | { kind: "scalar"; params: MonteCarloParams };

/** A worker that never answers must not hang the button. */
const WORKER_TIMEOUT_MS = 4000;

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Stable cache key from the params, ignoring the seed (same inputs → reuse).
 *
 * Every field that changes the RESULT has to be in here. The withdrawal
 * strategy and the stress scenario are the newest examples: leave them out and
 * switching strategy would silently replay the cached run for the old one.
 */
export function hashSimParams(message: SimulationMessage): string {
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  const p = message.params;
  const shared = {
    kind: message.kind,
    initialCapital: r(p.initialCapital),
    monthlyContribution: r(p.monthlyContribution),
    years: p.years,
    runs: p.runs,
    withdrawalYears: p.withdrawalYears ?? 0,
    withdrawalRate: r(p.withdrawalRate ?? 0),
    withdrawalStrategy: p.withdrawalStrategy ?? "fixed",
    guardrailBand: p.guardrailBand ?? null,
    guardrailAdjust: p.guardrailAdjust ?? null,
    floor: p.floor ?? null,
    ceiling: p.ceiling ?? null,
    stress: p.stress ?? "none",
    inflation: p.inflation == null ? null : r(p.inflation),
    compareStrategies: p.compareStrategies === true,
    annualPensionIncome: r(p.annualPensionIncome ?? 0),
    pensionYearsUntilStart:
      p.pensionYearsUntilStart == null ? null : r(p.pensionYearsUntilStart),
  };
  const canon =
    message.kind === "portfolio"
      ? {
          ...shared,
          rebalanceYearly: !!message.params.rebalanceYearly,
          assets: message.params.assets.map((a) => ({
            weight: r(a.weight),
            mean: r(a.mean),
            vol: r(a.vol),
          })),
          corr: message.params.corr.map((row) => row.map(r)),
        }
      : {
          ...shared,
          expectedReturn: r(message.params.expectedReturn),
          volatility: r(message.params.volatility),
        };
  return fnv1a(JSON.stringify(canon));
}

/** A fresh 32-bit seed from Web Crypto (never Math.random), so a run is
 *  reproducible and the seed can be persisted for auditing. */
export function randomSeed(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
}

export interface MonteCarloRun {
  result: MonteCarloResult | null;
  running: boolean;
  /** Runs `message`, reusing a stored run with the same inputs if there is one. */
  run(message: SimulationMessage): void;
  /** Drops the current result (e.g. when the inputs changed underneath it). */
  clear(): void;
}

/**
 * Run the simulation off the main thread, with a stored-result cache in front
 * and the pure computation behind.
 *
 * Prefer a Web Worker for the background execution the PRD asks for, but never
 * let a worker hiccup break the feature: any failure to construct, load, or
 * respond falls back to the same pure computation on the main thread. The sim
 * is fast enough that the fallback is imperceptible.
 */
export function useMonteCarloRun(): MonteCarloRun {
  const { loadSimulation, saveSimulation } = usePortfolio();
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  const run = (message: SimulationMessage) => {
    const hash = hashSimParams(message);
    const seed = message.params.seed;
    setRunning(true);

    let settled = false;
    const finish = (r: MonteCarloResult, fromCache = false) => {
      if (settled) return;
      settled = true;
      setResult(r);
      setRunning(false);
      workerRef.current?.terminate();
      workerRef.current = null;
      // Persist fresh runs so an identical re-run reuses the stored result.
      if (!fromCache) {
        void saveSimulation({
          hash,
          params: message.params,
          seed,
          result: r,
          createdAt: new Date().toISOString(),
        }).catch(() => {});
      }
    };

    const fallback = () =>
      finish(
        message.kind === "portfolio"
          ? runPortfolioMonteCarlo(message.params)
          : runMonteCarlo(message.params),
      );

    const compute = () => {
      try {
        const worker = new Worker(new URL("../finance/monte-carlo.worker.ts", import.meta.url));
        workerRef.current?.terminate();
        workerRef.current = worker;
        const watchdog = setTimeout(fallback, WORKER_TIMEOUT_MS);
        worker.onmessage = (e: MessageEvent<MonteCarloResult>) => {
          clearTimeout(watchdog);
          finish(e.data);
        };
        worker.onerror = () => {
          clearTimeout(watchdog);
          fallback();
        };
        worker.postMessage(message);
      } catch {
        fallback();
      }
    };

    // Reuse a stored run with identical params before computing anything.
    void loadSimulation(hash)
      .then((cached) => {
        if (settled) return;
        if (cached && cached.result) {
          finish(cached.result as MonteCarloResult, true);
        } else {
          compute();
        }
      })
      .catch(() => {
        if (!settled) compute();
      });
  };

  return { result, running, run, clear: () => setResult(null) };
}
