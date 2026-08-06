"use client";

/** Renders a grounded answer.
 *
 * A full Markdown library would add ~40 KB to the bundle to support syntax we
 * explicitly instruct the model not to emit. This handles what the prompt
 * actually produces — paragraphs, bullet and numbered lists, small headings,
 * bold, inline code — and turns every `[n]` marker into a live citation pill.
 */

import { Fragment, useMemo } from "react";
import { cn } from "@/lib/utils";

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

const BULLET = /^\s*[-*•]\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;
const HEADING = /^\s*#{1,6}\s+/;

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ...list });
      list = null;
    }
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (HEADING.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: line.replace(HEADING, "") });
      continue;
    }
    const bullet = BULLET.test(line);
    const ordered = !bullet && ORDERED.test(line);
    if (bullet || ordered) {
      flushParagraph();
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(line.replace(bullet ? BULLET : ORDERED, ""));
      continue;
    }

    if (list) {
      // A wrapped continuation of the previous bullet.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[\d{1,2}\])/g;

function Inline({
  text,
  onCite,
  activeMarker,
  citedMarkers,
}: {
  text: string;
  onCite?: (marker: number) => void;
  activeMarker?: number | null;
  citedMarkers?: Set<number>;
}) {
  const parts = text.split(INLINE).filter(Boolean);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (
          part.length > 2 &&
          ((part.startsWith("*") && part.endsWith("*")) ||
            (part.startsWith("_") && part.endsWith("_")))
        ) {
          return <em key={index}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        const citation = /^\[(\d{1,2})\]$/.exec(part);
        if (citation) {
          const marker = Number(citation[1]);
          // Only linkify markers that map to a retrieved passage.
          if (citedMarkers && !citedMarkers.has(marker)) {
            return <Fragment key={index}>{part}</Fragment>;
          }
          return (
            <button
              key={index}
              type="button"
              className="citation-pill"
              data-active={activeMarker === marker}
              onClick={() => onCite?.(marker)}
              aria-label={`Show source ${marker}`}
            >
              {marker}
            </button>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

export function AnswerBody({
  content,
  onCite,
  activeMarker,
  availableMarkers,
  streaming,
  className,
}: {
  content: string;
  onCite?: (marker: number) => void;
  activeMarker?: number | null;
  availableMarkers?: number[];
  streaming?: boolean;
  className?: string;
}) {
  const blocks = useMemo(() => parse(content), [content]);
  const citedMarkers = useMemo(
    () => (availableMarkers ? new Set(availableMarkers) : undefined),
    [availableMarkers],
  );

  const inlineProps = { onCite, activeMarker, citedMarkers };

  return (
    <div className={cn("prose-answer", className)}>
      {blocks.map((block, index) => {
        const last = index === blocks.length - 1;
        if (block.kind === "heading") {
          return (
            <h3 key={index}>
              <Inline text={block.text} {...inlineProps} />
            </h3>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} {...inlineProps} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={index} className={cn(streaming && last && "stream-caret")}>
            <Inline text={block.text} {...inlineProps} />
          </p>
        );
      })}
      {!blocks.length && streaming ? <p className="stream-caret" /> : null}
    </div>
  );
}
