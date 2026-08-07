"use client";

// The guaranteed income a plan may lean on, derived once for every surface
// that plans around it.
//
// The FIRE tab and the simulator's withdrawal phase both need it, and both must
// read it from the SAME `projectPension` the Pension tab renders -- a bridge
// derived twice is a bridge that eventually disagrees with the page it came
// from.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { projectPension } from "@/lib/finance/pension";
import type { PensionBridge } from "@/lib/finance/fire";
import { today } from "@/lib/finance/dates";
import { usePensionReference } from "./use-pension-reference";

export interface PensionBridgeInputs {
  /** Whether the pension feature is on at all. */
  enabled: boolean;
  /** The bridge, or undefined when the pension cannot be valued. */
  bridge: PensionBridge | undefined;
  /** Projected monthly pension (statutory + private, or private alone when the
   *  statutory half cannot be valued). */
  monthly: number;
  /** Calendar year the pension starts, or null without a birth year. */
  retirementYear: number | null;
}

export function usePensionBridge(): PensionBridgeInputs {
  const { data } = usePortfolio();
  const reference = usePensionReference();
  const enabled = useFeatureFlag("pension");
  const todayIso = today();

  const projection = useMemo(
    () =>
      projectPension({
        entries: data.pensionPoints,
        statements: data.pensionStatements,
        contracts: data.pensionContracts,
        contractValues: data.pensionContractValues,
        reference,
        settings: data.profile.pensionSettings,
        currentYear: Number(todayIso.slice(0, 4)),
      }),
    [
      data.pensionPoints,
      data.pensionStatements,
      data.pensionContracts,
      data.pensionContractValues,
      data.profile.pensionSettings,
      reference,
      todayIso,
    ],
  );

  // Without a Rentenwert the statutory half cannot be valued, so only the
  // private policies count -- the same "report what is known, invent nothing"
  // rule the Pension tab follows.
  const monthly = projection.monthlyTotal ?? projection.monthlyPrivate;
  const bridge: PensionBridge | undefined =
    enabled && projection.retirementYear != null && monthly > 0
      ? {
          annualIncome: monthly * 12,
          yearsUntilStart: Math.max(0, projection.retirementYear - Number(todayIso.slice(0, 4))),
        }
      : undefined;

  return { enabled, bridge, monthly, retirementYear: projection.retirementYear };
}
