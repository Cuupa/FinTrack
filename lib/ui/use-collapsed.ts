"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A boolean collapse state persisted per-browser under
 * `fintrack-collapsed:<key>`. SSR and first paint always render the default;
 * the saved value is hydrated in a deferred effect (same idiom as the theme and
 * locale providers) so it is never a synchronous setState in an effect, which
 * Next 16's `react-hooks/set-state-in-effect` rule fails the build on.
 */
export function useCollapsed(key: string, defaultCollapsed = false) {
  const storageKey = `fintrack-collapsed:${key}`;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved === "1" || saved === "0") setCollapsed(saved === "1");
      } catch {
        /* ignore */
      }
    });
  }, [storageKey]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [storageKey]);

  return [collapsed, toggle] as const;
}
