import { describe, expect, it } from "vitest";
import { formatCompactJson, formatFullJson } from "../lib/admin/audit-format";

describe("formatCompactJson", () => {
  it("renders null as an em-dash placeholder", () => {
    expect(formatCompactJson(null)).toEqual({ text: "—", truncated: false });
  });

  it("renders undefined as an em-dash placeholder", () => {
    expect(formatCompactJson(undefined)).toEqual({ text: "—", truncated: false });
  });

  it("renders a small object inline without truncation", () => {
    expect(formatCompactJson({ enabled: true })).toEqual({
      text: '{"enabled":true}',
      truncated: false,
    });
  });

  it("truncates a long value and flags it", () => {
    const value = { note: "x".repeat(100) };
    const result = formatCompactJson(value, 60);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(61); // 60 chars + ellipsis
    expect(result.text.endsWith("…")).toBe(true);
  });

  it("respects a custom maxLen boundary (exactly at the limit is not truncated)", () => {
    const value = { a: 1 };
    const json = JSON.stringify(value);
    const result = formatCompactJson(value, json.length);
    expect(result).toEqual({ text: json, truncated: false });
  });
});

describe("formatFullJson", () => {
  it("renders null as an em-dash placeholder", () => {
    expect(formatFullJson(null)).toBe("—");
  });

  it("pretty-prints an object with two-space indentation", () => {
    expect(formatFullJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
