---
name: styleguide
description: FinTrack's visual/UI conventions — colors, typography, spacing, the shared components/ui primitives, table/button/form/chart patterns, and the hard rules (no badges, tabular numbers, skeletons, informal du). Read before building or restyling any UI so it matches the app instead of re-deriving classes.
---

# FinTrack styleguide

Reach for the shared primitives in `components/ui/` before hand-rolling markup —
every card, button, table, form footer, tab strip and dialog already exists.
Hand-rolling an eighth copy of something that lives in `components/ui/` is the
mistake this guide exists to prevent. All values below are extracted from real
source; cite-check against the file if in doubt.

## Hard rules (non-negotiable)

- **No badges of any kind.** Filled pills are forbidden. Counts use an *outline
  ring* (`NotificationCount`: `rounded-full border border-emerald-600 text-emerald-600`,
  no fill). If you reach for a badge, redesign.
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
- **Dark mode is mandatory**: every color carries a `dark:` variant. No hardcoded
  hex in JSX — use semantic zinc/emerald/red/amber Tailwind classes.

## Color & theme

Tailwind v4, tokens in `app/globals.css`. Theme toggles via a `.dark` class on
`<html>` (class-based, not `prefers-color-scheme`).

- **Neutral scale: `zinc`** throughout (backgrounds, borders, text, hovers).
- **Accent: `emerald`** (`emerald-600` light / `emerald-400` dark) — primary accent,
  focus outlines, notification rings, "success/copied".
- **Gain vs loss** (`lib/format.ts` `plColor`): gain `text-emerald-600 dark:text-emerald-400`,
  loss `text-red-600 dark:text-red-400`, flat `text-zinc-500`. Use the helper, don't inline.
- **Warning / estimated / "N due": `amber`** (`amber-400/500/600`, `amber-100`/`amber-900` fills).
- **Destructive: `red`** (`danger` button, delete hover).
- **Chart categorical palette** is a 12-color deterministic list in `lib/colors.ts`,
  assigned by hash via `colorForLabel()` — never pick chart colors by hand.

Base surfaces: page `bg-white dark:bg-zinc-900`, borders `border-zinc-200 dark:border-zinc-800`.

## Typography & numbers

Fonts: Geist Sans (`--font-sans`), Geist Mono (`--font-mono`).

- **h1 / page title:** `text-2xl font-semibold tracking-tight` (via `PageHeader`).
- **h2 / section title:** `text-lg font-semibold` (via `SectionTitle`).
- **Labels:** `text-sm font-medium`; form field labels `mb-1 block text-xs font-medium text-zinc-500`.
- **Muted/secondary text:** `text-zinc-500`, usually `text-sm` or `text-xs`.
- **KPI value:** `text-2xl font-semibold tabular-nums` (via `Stat`).
- Weights used: `font-normal` / `font-medium` / `font-semibold` only.

## Spacing & layout

- **Vertical rhythm constants** (`primitives.tsx`): `PAGE_STACK = "space-y-6"` between
  major page blocks, `SECTION_STACK = "space-y-4"` inside a card. Import them.
- **Card padding:** `p-5` (tight variants `p-4`/`p-3`). **Page padding:** `p-4 sm:p-6`.
- **Form field gap:** `gap-4`. **Header flex gap:** `gap-3`. **Row-action gap:** `gap-0.5`.
- **Table cell:** `px-3 py-2`.
- Responsive stat grids come from `StatRow` (2→`sm:grid-cols-2`, 4→`grid-cols-2 lg:grid-cols-4`, etc).

## The primitive catalog — use these, don't rebuild

All in `components/ui/`:

| Primitive | Use it for |
| --- | --- |
| `Card` | any bordered container: `rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900` |
| `PageHeader` | page title + subtitle + right-aligned actions (stacks on mobile) |
| `SectionTitle` | h2 with optional `InfoTip` + actions |
| `Stat` / `StatRow` | KPI label+value pairs in a responsive grid |
| `Button` | every action button (variants below) |
| `SegmentedControl` | switch a control's *units* (timeframe, scale) — filled pills |
| `Tabs` | switch the whole *view* under it — underlined strip, renders its own padlock for locked tabs |
| `SelectMenu` | dropdowns; opt-in `searchable`, `multiple` (empty selection = "all", no sentinel), `footer` |
| `MonthPicker` | month/year filter, holds `string \| null` where null = every month, clearable via "×" |
| `FormActions` | the one form footer — cancel before commit, error text left |
| `Table` + `Thead`/`Tbody`/`Tr`/`Th`/`Td` | every table (sortable + hover built in) |
| `RowActions` + `EditAction`/`DeleteAction` | quiet icon buttons at a row's right edge |
| `Skeleton` / `SkeletonText` | pending values |
| `EmptyState` | "nothing here" + optional CTA |
| `LoadError` | failed load with retry (never leave it looking like loading) |
| `ConfirmDialog` | destructive confirmation |
| `Modal` | generic centered overlay (`max-w-2xl` default) |
| `InfoTip` | inline "i" circle + tooltip (`role="tooltip"`) |
| `CopyValue` | inline copy button for identifiers |
| `Toggle` | on/off switch (not a checkbox) |
| `Slider` | range input (`fin-slider`, CSS-driven) |
| `EstimatedBadge` | amber "estimated data" marker on synthetic figures (globally flag-gated) |
| `ProTeaser` / `ProGate` | wrap a locked feature's own view in a blur + subscribe CTA |

## Buttons

`<Button variant size>` — variants (`primitives.tsx`):

- `primary`: `bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white`
- `secondary` (default): `border border-zinc-300 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800`
- `ghost`: `text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800`
- `danger`: `border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950`

Base: `inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50`.
`size="sm"` only tightens on mobile (`px-2.5 py-1.5 text-xs md:px-3.5 md:py-2 md:text-sm`); default `px-3.5 py-2 text-sm`.

## Forms

- **Input:** `mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700` (focus = border-color only, no ring).
- **Required-field gating** (`lib/forms/required.ts`): disable submit on *presence only*
  via `useFormTouched`; mark a missing touched field with `missingFieldCls` →
  ` !border-amber-400 dark:!border-amber-600`, or `missingLabelCls` for borderless
  controls (amber label). Content validation (valid number, > 0) stays at submit time.
- **Footer is always `FormActions`**: `mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800`, error `<p class="mr-auto text-sm text-red-600">` on the left, cancel before the committing button.

## Tables (`components/ui/table.tsx`)

- Wrap in `<Table>` (`overflow-x-auto`). Header via `<Thead>` → `text-xs uppercase tracking-wide text-zinc-500`, cells `<Th sort sortKey onSort>` (real `<button>`, `aria-sort`, focus-visible emerald outline, reserved space for the sort caret).
- **Row:** `<Tr selected>` gives hover `hover:bg-zinc-50 dark:hover:bg-zinc-800/40` and selected tint `bg-zinc-100 dark:bg-zinc-800/50` automatically.
- Numeric `<Td>` cells get `tabular-nums`. Right-align row actions with `RowActions`.

## Charts (Recharts 3)

- **Never hardcode `YAxis width`** — compute with `yAxisWidth()` + `axisCurrencyFormatter` (`components/charts/axis.ts`) so the gutter stays snug. Compact with `formatCompactCurrency` (k/M/B in every locale).
- Line/series colors from `lib/colors.ts` (`colorForLabel`); gain `#059669`, loss `#ef4444`.
- Charts get `role="img"` + a dynamic localized `aria-label`. Log scale only in currency mode.
- Synthetic data carries `EstimatedBadge`. Privacy: mark sensitive figures `data-private` (blurred in incognito mode; charts blur only the y-axis and hide tooltips).

## Icons

Inline SVG only — **no icon library**. Stroke-only paths with `currentColor`, ~1.5pt stroke, `h-3.5 w-3.5` / `h-4 w-4`. Color idioms: quiet `text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200`; delete `hover:text-red-500`; success `text-emerald-600`. `LockIcon` lives in `pro-teaser.tsx`.

## States & feedback

- **Loading:** `<Skeleton>`/`<SkeletonText>` (`animate-pulse rounded-sm bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800`).
- **Empty:** `EmptyState` — centered `px-4 py-12 text-center`, title + hint + optional action.
- **Error:** `LoadError` inside a `Card` — message + retry. Never let a failed load read as a pending skeleton.
- **Due-review pattern:** amber "N due" notice directly under the card header + a "Prüfen" button, with the editable review table *immediately beneath the notice* (never separated by the card's own table). Datetime + amount inputs, sorted by the occurrence's immutable values, footed by cancel + "book N", panel capped `max-w-5xl`.
- **Overlays** (`ConfirmDialog`, `Modal`, `ProTeaser`): `bg-black/50 backdrop-blur-sm`, dialog `rounded-lg border ... shadow-xl`, focus-trapped via `use-focus-trap`.

## Accessibility baseline

Real `<button>` for anything clickable (never `<div onClick>`); `role="dialog"`/`"alertdialog"` + focus trap on modals; `role="tooltip"` on `InfoTip`; `aria-sort` on sortable headers; `focus-visible:outline focus-visible:outline-offset-2` (emerald) on focusable controls; `<html lang>` follows the active locale.
