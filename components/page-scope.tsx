"use client";

// The page's scope selector, resolved from the route. A portfolio is a broker
// holding assets and transactions, so its picker only means something where the
// content is actually filtered by it (holdings, analysis, dividends, ...); the
// account picker scopes /accounts the same way. This used to live in the global
// top bar, which implied the whole app sat inside one portfolio. It now belongs
// in the page header, next to the title of the content it scopes (spec 7.1).

import { usePathname } from "next/navigation";
import { scopesToAccounts, scopesToPortfolio } from "@/lib/nav/routes";
import { PortfolioPicker } from "./portfolio-picker";
import { AccountPicker } from "./account-picker";

export function PageScope() {
  const pathname = usePathname();
  if (scopesToPortfolio(pathname)) return <PortfolioPicker />;
  if (scopesToAccounts(pathname)) return <AccountPicker />;
  return null;
}
