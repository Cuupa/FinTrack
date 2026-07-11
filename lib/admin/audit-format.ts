// Pure formatting for admin_audit's jsonb old_value/new_value columns: a
// short one-line summary for the table cell, with a `truncated` flag the
// audit page uses to decide whether to offer an expand toggle for the full
// pretty-printed value. No React, no Supabase, same spirit as
// lib/admin/price-health.ts.

export interface CompactJson {
  text: string;
  truncated: boolean;
}

const DEFAULT_MAX_LEN = 60;

/** `null`/`undefined` (including a jsonb NULL column) render as an em-dash
 *  placeholder, matching the same glyph used for other empty cells
 *  across the admin pages (see e.g. app/admin/errors/page.tsx's `route`). */
export function formatCompactJson(value: unknown, maxLen: number = DEFAULT_MAX_LEN): CompactJson {
  if (value === null || value === undefined) return { text: "—", truncated: false };
  let json: string;
  try {
    json = JSON.stringify(value) ?? "—";
  } catch {
    return { text: "—", truncated: false };
  }
  if (json.length <= maxLen) return { text: json, truncated: false };
  return { text: `${json.slice(0, maxLen)}…`, truncated: true };
}

/** Full pretty-printed form for the expanded row. */
export function formatFullJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2) ?? "—";
  } catch {
    return "—";
  }
}
