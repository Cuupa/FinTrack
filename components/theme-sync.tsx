"use client";

// Applies the user's saved theme (profiles.theme) to the theme context once it
// loads, so the explicit light/dark choice follows the account across
// devices. Renders nothing. Guests / no saved theme keep their
// localStorage/system choice.

import { useEffect, useRef } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useTheme } from "@/lib/theme/theme-context";

export function ThemeSync() {
  const { data } = usePortfolio();
  const { explicit, setTheme } = useTheme();
  const applied = useRef<string | null>(null);

  useEffect(() => {
    const pt = data.profile.theme;
    if (!pt || pt === explicit || applied.current === pt) return;
    if (pt !== "light" && pt !== "dark") return;
    applied.current = pt;
    // Async continuation (not a synchronous setState in an effect).
    void Promise.resolve().then(() => setTheme(pt));
  }, [data.profile.theme, explicit, setTheme]);

  return null;
}
