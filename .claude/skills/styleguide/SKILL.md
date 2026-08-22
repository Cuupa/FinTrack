---
name: styleguide
description: FinTrack's visual/UI conventions after the redesign — the semantic design tokens (surface/text/brand/action/positive-negative + 6-color chart palette), typography, spacing, the shared components/ui primitives, table/button/form/chart patterns, and the hard rules (tabular numbers, skeletons, informal du). Read before building or restyling any UI so it matches the app instead of re-deriving classes.
---

# FinTrack styleguide

Reach for the shared primitives in `components/ui/` before hand-rolling markup —
every card, button, table, form footer, tab strip and dialog already exists.
Hand-rolling an eighth copy of something that lives in `components/ui/` is the
mistake this guide exists to prevent. All values below are extracted from real
source; cite-check against the file if in doubt.

The redesign moved the app onto **semantic design tokens** (UX-Unification-Spec
§5): roles, not raw palettes. New and restyled UI uses the token utilities
below (`bg-surface`, `text-primary`, `text-brand`, `text-positive`, …), not raw
`zinc`/`emerald`/`red`. The migration is not yet total — a few primitives
(tables, inputs, dialogs) still carry raw `zinc` and are noted where they do —
but the tokens are the vocabulary of record. Migrate a surface by swapping
`zinc`/`emerald` utilities for the token that names its role.

## Hard rules (non-negotiable)

- **Tabular numbers everywhere** a figure is shown: add `tabular-nums`. Currency,
  counts, percentages, table cells, KPIs.
- **Skeletons, never placeholder text/spinners** for pending values. Use
  `<Skeleton>` / `<SkeletonText>` (`animate-pulse ... motion-reduce:animate-none`).
- **Every table is sortable and rows highlight on hover.** Free with the `Tr`/`Th`
  primitives — never build a raw `<table>`.
- **Destructive actions confirm first** via `<ConfirmDialog>`.
- **No em-dashes** in any user-facing copy. Hyphens only.
- **German copy is informal du-register** (never "Sie" except as a real pronoun);
  Spanish is informal tú. Every dictionary key exists in en + de + es or tests fail.
- **Paywalled features stay visible**, blurred behind `<ProTeaser>`/`<ProGate>`, never hidden.
- **Dark mode is mandatory.** Prefer the semantic tokens (they carry both themes
  in one place, `app/globals.css`). Where you must reach for a raw palette, every
  color carries a `dark:` variant. No hardcoded hex in JSX.
- **The CTA fill is `action-primary` (near-black/near-white), never the brand.**
  The brand (a teal-green) is reserved for nav, tabs, focus and selection.

## Color & theme

Tailwind v4, tokens defined in `app/globals.css` as CSS custom properties on
`:root`, overridden under `.dark`, and mapped to utilities via `@theme inline`.
Theme is **class-based**: `lib/theme/theme-context.tsx` toggles the `dark` class
on `<html>` and takes precedence over the OS preference (`@custom-variant dark
(&:where(.dark, .dark *))`). Privacy mode toggles `.incognito` on `<html>`.

Semantic token utilities (light → dark hex for reference; use the utility, not the hex):

- **Surfaces:** `bg-app` (page `#f5f7f8`→`#090b0e`), `bg-sidebar`, `bg-surface`
  (card `#ffffff`→`#14171c`), `bg-surface-elevated`, `bg-surface-hover` (hover fill).
- **Borders:** `border-subtle` (`#dde2e7`→`#2a3039`), `border-strong` (`#c8d0d8`→`#3a424d`).
- **Text:** `text-primary` (`#14171a`→`#f4f6f8`), `text-secondary` (`#4d5966`→`#a8b0bc`),
  `text-tertiary` (`#6b7682`→`#8b95a3`, also the "flat/zero" color).
- **Brand** (`text-brand`/`bg-brand`/`border-brand`, `-brand-hover`): teal-green
  `#087f63`→`#2ad1a3`. Nav, tabs, selection, the `Slider` fill. NOT the CTA.
- **Action / CTA** (`bg-action-primary`, `hover:bg-action-primary-hover`,
  `text-action-primary-fg`): near-black `#18181b` on white → near-white `#f4f4f5`
  on `#18181b`. The single filled primary button per surface.
- **Gain vs loss** (`lib/format.ts` `plColor`): gain `text-positive`
  (`#177a45`→`#45d483`), loss `text-negative` (`#c9364a`→`#ff6b7a`), flat
  `text-tertiary`. **Use the helper, never inline a color.** Rounds-to-zero snaps
  to `+0` first via `normalizeZero`, so a hair-negative figure never shows as loss.
- **Warning / estimated / "N due": `text-warning`** (`#96620a`→`#f2b84b`).
- **Info: `text-info`** (`#1d64b7`→`#6ea8fe`).
- **Chart categorical palette: six neutral series** `chart-1..6`
  (`text-/fill-/stroke-chart-N`). They deliberately carry **no** gain/loss meaning.
  In JS, `lib/colors.ts` `PALETTE` is assigned by hash via `colorForLabel(label)`
  — its first six entries mirror the `--chart-1..6` tokens (`#5364d8`, `#1689a5`,
  `#7b50c7`, `#a96b0b`, `#a64a82`, `#647286`). Never pick a chart color by hand.

**Geometry:** `rounded-surface` (10px) for cards/strips/panels,
`rounded-control` (6px) for segmented controls and small controls. Buttons use
`rounded-md`. Spacing follows Tailwind's default scale (Spec §5.1).

**Still on raw `zinc`/`emerald` (un-migrated, match when editing them):** the
table header/row/cell, the form `<input>`, `FormActions`' top border, `Modal` /
`ConfirmDialog` chrome, `Stat`'s sub-line, and the emerald focus ring +
`NotificationCount` ring. New surfaces should prefer the tokens.

## Typography & numbers

Fonts: Geist Sans (`--font-sans`), Geist Mono (`--font-mono`).

- **h1 / page title:** `text-2xl font-semibold tracking-tight` (via `PageHeader`).
- **h2 / section title:** `text-lg font-semibold` (via `SectionTitle`; the app had
  drifted between `text-lg` and `text-base` — `SectionTitle` is the one rule).
- **Labels:** `text-sm font-medium`; form field labels `mb-1 block text-xs font-medium`.
- **Muted/secondary text:** `text-secondary` / `text-tertiary`, usually `text-sm`/`text-xs`.
- **KPI value:** `text-2xl font-semibold tabular-nums` (via `Stat`; `size="sm"` →
  `text-base md:text-xl`).
- Weights used: `font-normal` / `font-medium` / `font-semibold` only.

## Spacing & layout

- **Page rhythm:** `PAGE_STACK = "space-y-6"` (`primitives.tsx`) between major page
  blocks. Import it; a page never picks its own. (There is no `SECTION_STACK` — it
  was removed as dead; space inside a card with `space-y-4` directly if needed.)
- **Card padding:** `p-5` (tighter variants `p-4`/`p-3`). **Page padding:** `p-4 sm:p-6`.
- **Form field gap:** `gap-4`. **Header flex gap:** `gap-3`. **Row-action gap:** `gap-0.5`.
- **Table cell:** `px-3 py-2`.
- Responsive stat grids come from `StatRow` (2→`sm:grid-cols-2`, 3→`sm:grid-cols-3`,
  4→`grid-cols-2 lg:grid-cols-4`, 5→`grid-cols-2 md:grid-cols-3 lg:grid-cols-5`).

## The primitive catalog — use these, don't rebuild

All in `components/ui/`:

| Primitive | Use it for |
| --- | --- |
| `Card` | any bordered container: `rounded-surface border border-subtle bg-surface p-5 shadow-sm` |
| `PageHeader` | page title + subtitle + right-aligned actions (stacks on mobile); pairs with `PageHeaderWithTour` for the "?" replay |
| `SectionTitle` | h2 with optional `InfoTip` + actions |
| `Stat` / `StatRow` | KPI label+value pairs; `StatRow` lays them in a responsive grid |
| `SummaryStrip` (`summary-strip.tsx`) | the canonical KPI readout: 2-5 headline `metrics` as ONE divided surface (`flex ... divide-y sm:divide-x rounded-surface border-subtle bg-surface`), never a card per figure |
| `Button` | every action button (variants below) |
| `SegmentedControl` | switch a control's *units* (timeframe, scale) — filled pills, `rounded-control` |
| `Tabs` | switch the whole *view* under it — underlined strip, renders its own padlock for locked tabs |
| `SelectMenu` | dropdowns; opt-in `searchable`, `multiple` (empty selection = "all", no sentinel), `footer` |
| `MonthPicker` | month/year filter, holds `string \| null` where null = every month, clearable via "×" |
| `FormActions` | the one form footer — cancel before commit, error text left |
| `Table` + `Thead`/`Tbody`/`Tr`/`Th`/`Td` | every table (sortable + hover built in) |
| `RowActions` + `EditAction`/`DeleteAction` | quiet icon buttons at a row's right edge |
| `Skeleton` / `SkeletonText` | pending values |
| `EmptyState` | "nothing here" + optional CTA (the redesign moved add-forms behind these) |
| `LoadError` | failed load with retry (never leave it looking like loading) |
| `ConfirmDialog` | destructive confirmation (`max-w-sm`) |
| `Modal` | generic centered overlay (`max-w-2xl` default, override via `maxWidthClass`) |
| `InfoTip` | inline "i" circle + tooltip (`role="tooltip"`) |
| `CopyValue` | inline copy button for identifiers |
| `Toggle` | on/off switch (`h-6 w-11 rounded-full`, not a checkbox) |
| `Slider` | range input (`fin-slider`, CSS-driven, brand fill) |
| `NotificationCount` | outline-ring count on a nav entry (`rounded-full border border-emerald-600 text-emerald-600`, no fill) |
| `EstimatedBadge` | amber "estimated data" marker on synthetic figures (globally flag-gated) |
| `ProTeaser` / `ProGate` / `ProMenuItem` | wrap a locked feature's own view in a blur + subscribe CTA |

## Buttons

`<Button variant size>` — variants (`primitives.tsx`):

- `primary`: `bg-action-primary text-action-primary-fg hover:bg-action-primary-hover`
  (the neutral near-black/near-white CTA; one per surface).
- `secondary` (default): `border border-strong text-primary hover:bg-surface-hover`.
- `ghost`: `text-secondary hover:bg-surface-hover`.
- `danger` / `destructive` (aliases, same treatment): `border border-red-300
  text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950`.

Base: `inline-flex items-center justify-center gap-2 rounded-md font-medium
transition-colors disabled:opacity-50` + the shared `FOCUS_RING`. `size="sm"` only
tightens on mobile (`px-2.5 py-1.5 text-xs md:px-3.5 md:py-2 md:text-sm`); default
`px-3.5 py-2 text-sm`.

## Forms

- **Input** (still raw zinc): `mt-1 w-full rounded-md border border-zinc-300
  bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500
  dark:border-zinc-700` (focus = border-color only, no ring).
- **Required-field gating** (`lib/forms/required.ts`): disable submit on *presence
  only* via `useFormTouched`; mark a missing touched field with `missingFieldCls`
  → ` !border-amber-400 dark:!border-amber-600`, or `missingLabelCls` for
  borderless controls. Content validation (valid number, > 0) stays at submit time.
- **Footer is always `FormActions`**: `mt-4 flex flex-wrap items-center
  justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800`, error
  `<p class="mr-auto text-sm text-red-600 dark:text-red-400">` on the left, cancel
  before the committing button.
- **Add-forms are actions, not permanent content** (redesign §5.4): the empty
  state's CTA (or a header button) opens the form inside a `Modal`; the list/result
  is the resting state. Trigger and submit often share a label — scope the submit
  to the dialog.

## Tables (`components/ui/table.tsx`)

- Wrap in `<Table>` (`overflow-x-auto`; wide tables scroll inside their own card,
  the page body never scrolls sideways). Header via `<Thead>` → `text-xs uppercase
  tracking-wide text-zinc-500`, cells `<Th sort sortKey onSort>` (real `<button>`,
  `aria-sort`, focus-visible outline, reserved space for the sort caret).
- **Row:** `<Tr selected>` gives hover `hover:bg-zinc-50 dark:hover:bg-zinc-800/40`
  and selected tint `bg-zinc-100 dark:bg-zinc-800/50` automatically.
- Numeric `<Td>` cells get `tabular-nums`. Right-align row actions with `RowActions`.

## Charts (Recharts 3)

- **Never hardcode `YAxis width`** — compute with `yAxisWidth()` +
  `axisCurrencyFormatter` (`components/charts/axis.ts`; opt-in `{ perTick }` when
  each tick needs its own k/M magnitude, e.g. a log axis). Compact with
  `formatCompactCurrency` (k/M/B in every locale).
- **Categorical series** take their color from `colorForLabel` / the `chart-1..6`
  tokens — never gain/loss colors. A semantically negative element (a liabilities
  line, a shortfall, a SELL marker) may use red directly.
- Charts get `role="img"` + a dynamic localized `aria-label`. Log scale only in
  currency mode (log of a negative % is undefined).
- Synthetic data carries `EstimatedBadge`. Privacy: mark sensitive figures
  `data-private` (blurred in incognito); a chart with an absolute-currency y-axis
  gets `data-private-axis` (blurs the y-axis, hides tooltips) instead of blurring
  the plotted geometry.

## Icons

Inline SVG only — **no icon library**. Stroke-only paths with `currentColor`,
~1.5pt stroke, `h-3.5 w-3.5` / `h-4 w-4`. Color idioms: quiet `text-tertiary
hover:text-primary`; delete `hover:text-red-500`; success/brand `text-brand`.
`LockIcon` lives in `pro-teaser.tsx`.

## States & feedback

- **Loading:** `<Skeleton>`/`<SkeletonText>` (`animate-pulse rounded-sm bg-zinc-200
  motion-reduce:animate-none dark:bg-zinc-800`).
- **Empty:** `EmptyState` — centered `px-4 py-12 text-center`, title + hint +
  optional action. The primary "add your first X" entry point.
- **Error:** `LoadError` inside a `Card` — message + retry. Never let a failed load
  read as a pending skeleton.
- **Due-review pattern:** amber "N due" notice directly under the card header + a
  "Prüfen" button, with the editable review table *immediately beneath the notice*
  (never separated by the card's own table). `datetime-local` + amount inputs,
  sorted by the occurrence's immutable values, footed by cancel + "book N", panel
  capped `max-w-5xl`.
- **Overlays** (`ConfirmDialog`, `Modal`, `ProTeaser`): `bg-black/50
  backdrop-blur-sm`, dialog `rounded-lg border ... shadow-xl`, focus-trapped via
  `use-focus-trap`.

## Accessibility baseline

Real `<button>` for anything clickable (never `<div onClick>`);
`role="dialog"`/`"alertdialog"` + focus trap on modals; `role="tooltip"` on
`InfoTip`; `aria-sort` on sortable headers. The shared `FOCUS_RING` is
`focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400` — put it
on every focusable control. `<html lang>` follows the active locale.
