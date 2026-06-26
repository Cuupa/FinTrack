// Web Worker running the Monte Carlo simulation off the main thread
// (PRD §3.3). Handles both the scalar (single μ/σ) and the portfolio-aware
// (per-asset, correlated) simulations.

import {
  runMonteCarlo,
  runPortfolioMonteCarlo,
  type MonteCarloParams,
  type PortfolioMonteCarloParams,
} from "./monte-carlo";

type Message =
  | { kind: "scalar"; params: MonteCarloParams }
  | { kind: "portfolio"; params: PortfolioMonteCarloParams };

self.onmessage = (event: MessageEvent<Message>) => {
  const msg = event.data;
  const result =
    msg.kind === "portfolio"
      ? runPortfolioMonteCarlo(msg.params)
      : runMonteCarlo(msg.params);
  (self as unknown as Worker).postMessage(result);
};
