// One calm inline notice for domain hints, assumptions and warnings
// (UX-Unification-Spec §7.10), replacing the per-page amber boxes that had
// grown their own colors and borders. Four semantic variants, each tied to a
// role token so light and dark come from one definition. Not a dominant
// banner: a quiet tinted surface with an icon and text.

import type { ReactNode } from "react";

type Variant = "info" | "success" | "warning" | "error";

const STYLES: Record<Variant, { wrap: string; icon: ReactNode }> = {
  info: {
    wrap: "border-info/30 bg-info/10 text-info",
    icon: <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />,
  },
  success: {
    wrap: "border-positive/30 bg-positive/10 text-positive",
    icon: <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />,
  },
  warning: {
    wrap: "border-warning/30 bg-warning/10 text-warning",
    icon: <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />,
  },
  error: {
    wrap: "border-negative/30 bg-negative/10 text-negative",
    icon: <path d="M12 8v4m0 4h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" strokeLinecap="round" />,
  },
};

export function InlineNotice({
  variant = "info",
  title,
  action,
  className = "",
  children,
}: {
  variant?: Variant;
  /** Optional bolded lead line above the body. */
  title?: string;
  /** Trailing action (e.g. a "Prüfen" button), right-aligned. */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const s = STYLES[variant];
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-control border px-3.5 py-2.5 text-sm ${s.wrap} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
        className="mt-0.5 h-4 w-4 shrink-0"
      >
        {variant === "info" || variant === "error" ? <circle cx="12" cy="12" r="10" /> : null}
        {s.icon}
      </svg>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-primary">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-secondary" : ""}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
