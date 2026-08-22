"use client";

// Shared money input: a decimal-tolerant amount field with the currency symbol
// as a right-aligned adornment. The value stays a raw string in the parent
// (so `parseDecimal` and the mode's sign decision live there); this component
// only styles it, blurs it into a grouped display ("1595" -> "1.595,00"), and
// paints an amber border when the parent flags it invalid. Replaces the
// hand-rolled `<Input inputMode="decimal">` + separate "(EUR)" label that the
// booking and settings forms each rebuilt.

import { INPUT_CLS } from "./primitives";
import { Field } from "./primitives";
import { currencySymbol, formatAmountInput, parseDecimal, stripLeadingZero } from "@/lib/format";

export function CurrencyField({
  id,
  label,
  currency,
  value,
  onChange,
  placeholder = "0",
  isPrivate = true,
  autoFocus = false,
  invalid = false,
  onEnter,
  className = "",
}: {
  id: string;
  label: string;
  currency: string;
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  /** Blur the absolute figure in Incognito mode (money always is). */
  isPrivate?: boolean;
  autoFocus?: boolean;
  /** Amber border when the parent's validation rejected this field. */
  invalid?: boolean;
  onEnter?: () => void;
  className?: string;
}) {
  const symbol = currencySymbol(currency);
  return (
    <Field label={label} htmlFor={id} className={className}>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(stripLeadingZero(e.target.value))}
          onBlur={() => {
            const n = parseDecimal(value);
            if (Number.isFinite(n)) onChange(formatAmountInput(Math.abs(n)));
          }}
          onKeyDown={onEnter ? (e) => { if (e.key === "Enter") onEnter(); } : undefined}
          placeholder={placeholder}
          data-private={isPrivate && value !== "" ? "" : undefined}
          className={`${INPUT_CLS} pr-9 tabular-nums${
            invalid ? " !border-amber-400 dark:!border-amber-600" : ""
          }`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 top-1 flex items-center text-sm text-tertiary">
          {symbol}
        </span>
      </div>
    </Field>
  );
}
