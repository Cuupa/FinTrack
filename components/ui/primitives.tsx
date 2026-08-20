// Small Tailwind UI primitives shared across the app.
//
// The layout primitives at the bottom (PageHeader, SectionTitle, EmptyState)
// exist because ~18 pages had reimplemented the same page header markup and
// the same "nothing here yet" message six different ways. Their job is to
// hold one spacing and typography scale so a new surface inherits it instead
// of picking new values.

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { InfoTip } from "./info-tip";

// One keyboard-focus ring for every interactive primitive (WCAG 2.4.7). The
// emerald outline only shows for keyboard focus (focus-visible), never on a
// mouse click, so it never competes with the hover/active styling. Matches the
// sortable table header's ring so focus reads the same everywhere.
export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400";

export function Card({
  children,
  className = "",
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-surface border border-subtle bg-surface p-5 shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  valueClassName = "",
  info,
  isPrivate = false,
  size = "md",
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
  /** Optional short explanation shown via an ⓘ tooltip next to the label. */
  info?: string;
  /** Mark the figure as an absolute amount, blurred in Incognito mode. */
  isPrivate?: boolean;
  /** "sm" tightens the value font + spacing (used to keep the hero compact). */
  size?: "sm" | "md";
}) {
  // "sm" is only used by the dashboard hero's 6-up KPI grid — shrink it
  // further on mobile (where 6 stats otherwise cost several screens of
  // scroll) and restore the original size at md: for a pixel-identical
  // desktop.
  const valueSize = size === "sm" ? "text-base md:text-xl" : "text-2xl";
  const labelTextSize = size === "sm" ? "text-xs md:text-sm" : "text-sm";
  const labelMin = size === "sm" ? "min-h-[1.25rem] md:min-h-[1.75rem]" : "min-h-[2.25rem]";
  const subTextSize = size === "sm" ? "text-xs md:text-sm" : "text-sm";
  return (
    <div>
      {/* Inline (not flex) so the ⓘ flows right after the text and wraps with it;
          min-height reserves two lines so values stay aligned when a (e.g.
          German) label wraps. */}
      <div className={`flex ${labelMin} items-start ${labelTextSize} leading-snug text-zinc-500`}>
        <span>
          {label}
          {info && (
            <span
              className="ml-1 inline-flex translate-y-0.5 align-text-bottom"
              {...(isPrivate ? { "data-private": "" } : {})}
            >
              <InfoTip text={info} />
            </span>
          )}
        </span>
      </div>
      <div
        className={`mt-0.5 md:mt-1 ${valueSize} font-semibold tabular-nums ${valueClassName}`}
        {...(isPrivate ? { "data-private": "" } : {})}
      >
        {value}
      </div>
      {sub && (
        <div
          className={`mt-0.5 ${subTextSize} text-zinc-500 tabular-nums`}
          {...(isPrivate ? { "data-private": "" } : {})}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * A row of KPIs as ONE card, never one card per figure.
 *
 * Both shapes had grown side by side: nine surfaces grouped their figures in a
 * single card, five gave every figure a card of its own. The split form reads
 * as unrelated facts rather than one readout, and the two shapes sat two tabs
 * apart on /analysis. Grouped wins; this is the only way to build the row.
 */
export function StatRow({
  cols = 4,
  children,
  className = "",
  ...rest
}: {
  /** Widest column count; narrower breakpoints step down from it. */
  cols?: 2 | 3 | 4 | 5;
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <Card className={className} {...rest}>
      <div className={`grid gap-4 ${STAT_COLS[cols]}`}>{children}</div>
    </Card>
  );
}

// Spelled out rather than interpolated: Tailwind only emits classes it can
// find as complete strings in the source.
const STAT_COLS: Record<2 | 3 | 4 | 5, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
};

/**
 * A row of 2-5 headline figures as ONE divided surface (UX-Unification-Spec
 * §7.2), the canonical KPI readout. Unlike {@link StatRow} it draws no card
 * per figure: the cells share a single bordered surface, split by hairline
 * dividers — vertical on desktop, horizontal when the grid wraps. Semantic
 * tokens (bg-surface / border-subtle) so light and dark come from one place.
 */
export type SummaryItem = {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
  info?: string;
  isPrivate?: boolean;
};

// Spelled out so Tailwind emits the classes: column count plus the matching
// point at which vertical dividers replace the stacked horizontal ones.
const SUMMARY_COLS: Record<2 | 3 | 4 | 5, string> = {
  2: "sm:grid-cols-2 sm:divide-x sm:[&>*]:border-t-0",
  3: "sm:grid-cols-3 sm:divide-x sm:[&>*]:border-t-0",
  4: "grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x",
};

export function SummaryStrip({
  items,
  className = "",
}: {
  items: SummaryItem[];
  className?: string;
}) {
  const cols = Math.min(5, Math.max(2, items.length)) as 2 | 3 | 4 | 5;
  return (
    <div
      className={`grid overflow-hidden rounded-surface border border-subtle bg-surface divide-subtle ${SUMMARY_COLS[cols]} ${className}`}
    >
      {items.map((it, i) => (
        <div key={i} className="min-h-[5.25rem] border-t border-subtle p-5 first:border-t-0">
          <Stat
            label={it.label}
            value={it.value}
            sub={it.sub}
            valueClassName={it.valueClassName}
            info={it.info}
            isPrivate={it.isPrivate}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A titled block of content (UX-Unification-Spec §7.3). Optional title,
 * description and an action slot on the right; content begins below with the
 * standard rhythm. `bordered` wraps it in a surface for blocks that need a
 * boundary; the default is frameless so a page is not a stack of nested cards.
 */
export function Section({
  title,
  description,
  actions,
  bordered = false,
  className = "",
  children,
}: {
  title?: ReactNode;
  description?: string;
  actions?: ReactNode;
  bordered?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const frame = bordered
    ? "rounded-surface border border-subtle bg-surface p-5"
    : "";
  return (
    <section className={`${frame} ${className}`}>
      {(title || actions) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-primary">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-secondary">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// "destructive" is the spec's name (§7.5); "danger" stays as an alias so the
// existing call sites keep working. Both render the same outline-red treatment.
type Variant = "primary" | "secondary" | "ghost" | "danger" | "destructive";

// Brand-primary (§7.5): the mint brand carries dark text in dark mode, where
// white on it fails contrast; the darker green in light mode carries white.
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover dark:text-zinc-950",
  secondary:
    "border border-strong text-primary hover:bg-surface-hover",
  ghost: "text-secondary hover:bg-surface-hover",
  danger:
    "border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
  destructive:
    "border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  // "sm" tightens padding/font on mobile only, restoring the original "md"
  // sizing at md: — used where a button would otherwise wrap on narrow
  // screens (e.g. the dashboard's "+ Add position").
  const sizeCls =
    size === "sm"
      ? "px-2.5 py-1.5 text-xs md:px-3.5 md:py-2 md:text-sm"
      : "px-3.5 py-2 text-sm";
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${sizeCls} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------------------
   Layout scale
   -------------------------------------------------------------------------- */

/** Vertical rhythm between the major blocks of a page (header, then cards).
    Exported rather than inlined so a page never quietly picks its own. */
export const PAGE_STACK = "space-y-6";

/** Rhythm between sections inside one card. */
export const SECTION_STACK = "space-y-4";

/**
 * The standard page header: title, optional one-line subtitle, optional
 * right-aligned actions. Actions wrap under the title on narrow screens
 * rather than squeezing it.
 */
export function PageHeader({
  title,
  subtitle,
  scope,
  actions,
  titleAdornment,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Scope selector (portfolio / account picker) for the whole page. Sits at
      the head of the right-hand control group, before the timeframe and any
      action, per the unified header order (spec 7.1). */
  scope?: ReactNode;
  /** Primary/secondary actions for the whole page, e.g. "+ Add asset". */
  actions?: ReactNode;
  /** Sits inline after the title rather than out in the actions group —
      the ghost "?" tour replay button every tour surface carries. */
  titleAdornment?: ReactNode;
  /** Anything that belongs under the header but above the content, such as
      a scope selector. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {titleAdornment}
        </div>
        {subtitle && <p className="text-sm text-secondary">{subtitle}</p>}
        {children}
      </div>
      {(scope || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {scope}
          {actions}
        </div>
      )}
    </div>
  );
}

/** Heading for a card or a section within one — the canonical h2 treatment
    (the app had drifted between text-lg and text-base with no rule). */
export function SectionTitle({
  children,
  info,
  actions,
}: {
  children: ReactNode;
  /** Optional short explanation shown via an ⓘ tooltip. */
  info?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-1.5 text-lg font-semibold">
        {children}
        {info && <InfoTip text={info} />}
      </h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * "Nothing here yet" for an empty list or chart.
 *
 * `action` is deliberately prominent in the signature: the six shapes this
 * replaces all told the user the surface was empty without offering the one
 * thing they could do about it.
 */
export function EmptyState({
  title,
  hint,
  action,
  className = "",
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center px-4 py-12 text-center ${className}`}>
      <p className="text-sm font-medium text-secondary">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-tertiary">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// The one text-input styling. This exact string had been copy-pasted as a
// local `inputCls` in ~16 forms; `Input` owns it now. Callers append their own
// classes (e.g. the amber `missingFieldCls`) after a space and they win via the
// later position / the `!` override.
export const INPUT_CLS =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

/**
 * A styled text input carrying {@link INPUT_CLS}. It is a thin wrapper over the
 * native `<input>` (every prop passes through), so `type`, `inputMode`,
 * `onKeyDown`, `data-private` etc. work unchanged — the only value it adds is
 * not restating the border/focus classes in every form.
 */
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${INPUT_CLS}${className ? ` ${className}` : ""}`} {...props} />;
}

/**
 * A labelled form field: the `text-sm font-medium` label above its control,
 * with an optional muted hint below it. `children` is the control itself (an
 * {@link Input}, a `SelectMenu`, anything), so the wrapper stays layout-only —
 * it replaces the hand-rolled `<div><label/>…</div>` triple the data-entry
 * forms each rebuilt. Pass `htmlFor` + a matching `id` on the control to keep
 * the label association for a plain input; controls with their own trigger
 * (SelectMenu) carry their own `ariaLabel` instead and omit it.
 */
export function Field({
  label,
  htmlFor,
  hint,
  className = "",
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/**
 * On/off switch as a sliding track, not a checkbox (owner rule): a checkbox
 * means "include this row", a switch means "this mode is on". Keep checkboxes
 * for multi-select lists.
 */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  hintPrivate = false,
  disabled = false,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  hintPrivate?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`group flex items-center gap-3 rounded-md text-left disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
    >
      <span
        aria-hidden
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked
            ? "bg-emerald-600 dark:bg-emerald-500"
            : "bg-zinc-300 group-hover:bg-zinc-400 dark:bg-zinc-700 dark:group-hover:bg-zinc-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-[1.375rem]" : "translate-x-0.5"
          }`}
        />
      </span>
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-zinc-500" {...(hintPrivate ? { "data-private": "" } : {})}>{hint}</span>}
      </span>
    </button>
  );
}

/** Segmented control for toggles (timeframe, scale, display mode). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div className="inline-flex flex-wrap rounded-control border border-subtle bg-surface-hover p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={opt.value === value}
          className={`rounded-sm font-medium transition-colors ${FOCUS_RING} ${pad} ${
            opt.value === value
              ? "bg-surface text-primary shadow-sm"
              : "text-tertiary hover:text-primary"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
