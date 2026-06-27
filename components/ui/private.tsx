// Wrap an absolute financial figure so Incognito mode can blur it. The actual
// blur is a global CSS rule (`.incognito [data-private]`) keyed off the class
// PrivacyProvider toggles on <html>, so this stays a cheap, context-free span.

import type { ReactNode } from "react";

export function Private({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span data-private className={className}>
      {children}
    </span>
  );
}
