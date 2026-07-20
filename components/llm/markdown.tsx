"use client";

// A tiny, dependency-free Markdown renderer for the assistant's chat replies.
// The LLM answers in Markdown (bold, lists, inline code, headings), so plain
// `whitespace-pre-wrap` showed the raw `**...**` / `1.` syntax. This turns the
// common subset into React nodes — no external library (keeps the bundle and
// CSP untouched) and no `dangerouslySetInnerHTML` (text becomes React children,
// so it is escaped by construction, never injected as HTML).
//
// It parses block by block (headings, ordered/unordered lists, paragraphs)
// and then inline (**bold**, *italic* / _italic_, `code`). Everything degrades
// to literal text: a half-streamed `**bold` with no closing marker renders as
// the literal characters rather than swallowing the rest of the message, so it
// stays readable while a reply is still streaming in.

import { Fragment, type ReactNode } from "react";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; lines: string[] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const UL_ITEM = /^\s*[-*]\s+(.*)$/;
const OL_ITEM = /^\s*\d+\.\s+(.*)$/;

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "paragraph", lines: para });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "") {
      flushPara();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const ulm = UL_ITEM.exec(line);
    const olm = OL_ITEM.exec(line);
    if (ulm || olm) {
      flushPara();
      const ordered = olm != null;
      const marker = (m: string) => (ordered ? OL_ITEM.exec(m) : UL_ITEM.exec(m));
      const items: string[] = [(olm ?? ulm)![1]];

      // Consume a whole (possibly "loose") list: same-kind item lines start new
      // items; indented wrapped lines continue the current item; a blank line is
      // swallowed only when the list clearly continues after it. LLM replies
      // routinely number items with indented explanation lines and a blank line
      // between them, which must stay one list (so <ol> numbers 1, 2, 3, ...).
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nextItem = marker(next);
        if (nextItem) {
          items.push(nextItem[1]);
          i++;
          continue;
        }
        if (next.trim() === "") {
          // Peek past the blank line: keep going only if the list resumes.
          const after = lines[i + 2] ?? "";
          if (marker(after) || (/^\s+\S/.test(after) && after.trim() !== "")) {
            i++;
            continue;
          }
          break;
        }
        if (/^\s+\S/.test(next)) {
          // Indented continuation of the current item (wrapped text).
          items[items.length - 1] += ` ${next.trim()}`;
          i++;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

// Inline formatting: `code` first (so ** / * inside code stay literal), then
// **bold**, then *italic* / _italic_. Unmatched markers fall through as text.
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m || m.index === undefined) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${k++}`;
    if (token.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/15"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold">
          {renderInline(token.slice(2, -2), key)}
        </strong>,
      );
    } else {
      // *italic* or _italic_
      out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

/** Render the LLM's Markdown subset as React nodes. Safe for partial input. */
export function Markdown({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        if (block.kind === "heading") {
          const cls =
            block.level <= 1
              ? "text-base font-semibold"
              : block.level === 2
                ? "text-sm font-semibold"
                : "text-sm font-medium";
          return (
            <p key={bi} className={cls}>
              {renderInline(block.text, `h-${bi}`)}
            </p>
          );
        }
        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={bi}
              className={`${
                block.ordered ? "list-decimal" : "list-disc"
              } space-y-1 pl-5 marker:text-zinc-400 dark:marker:text-zinc-500`}
            >
              {block.items.map((item, ii) => (
                <li key={ii}>{renderInline(item, `l-${bi}-${ii}`)}</li>
              ))}
            </ListTag>
          );
        }
        // paragraph: join lines with <br/> so soft line breaks are preserved.
        return (
          <p key={bi} className="whitespace-pre-wrap break-words">
            {block.lines.map((line, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(line, `p-${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
