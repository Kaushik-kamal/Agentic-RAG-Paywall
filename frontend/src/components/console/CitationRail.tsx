"use client";

import { FileText, Hash, Quote } from "lucide-react";

import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CitationRail({
  citations,
  activeMarker,
  onSelect,
}: {
  citations: Citation[];
  activeMarker: number | null;
  onSelect: (marker: number | null) => void;
}) {
  if (!citations.length) return null;

  const used = citations.filter((citation) => citation.used);
  const unused = citations.filter((citation) => !citation.used);

  /** A document's H1 usually repeats its title — don't print it twice. */
  const sectionPath = (citation: Citation): string =>
    citation.section
      .split(" › ")
      .filter(
        (crumb, index) =>
          crumb.trim() &&
          !(index === 0 && crumb.trim().toLowerCase() === citation.document_title.trim().toLowerCase()),
      )
      .join(" › ");

  return (
    <div className="space-y-2">
      <p className="text-eyebrow">
        Sources · {used.length} cited of {citations.length} retrieved
      </p>

      <ul className="space-y-1.5">
        {[...used, ...unused].map((citation) => (
          <li key={citation.chunk_id}>
            <button
              type="button"
              onClick={() =>
                onSelect(activeMarker === citation.marker ? null : citation.marker)
              }
              aria-expanded={activeMarker === citation.marker}
              className={cn(
                "w-full rounded-[var(--radius-sm)] border p-2.5 text-left transition-all duration-150",
                activeMarker === citation.marker
                  ? "border-[color:var(--line-accent)] bg-[var(--accent-soft)]"
                  : "border-[color:var(--line)] bg-[var(--surface-raised)] hover:border-[color:var(--line-strong)]",
                !citation.used && "opacity-65",
              )}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "mono mt-px grid h-5 min-w-5 shrink-0 place-items-center rounded px-1 text-[0.625rem] font-semibold",
                    citation.used
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--surface-active)] text-[var(--text-faint)]",
                  )}
                >
                  {citation.marker}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[var(--text)]">
                    {citation.document_title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] text-[var(--text-muted)]">
                    {sectionPath(citation) ? (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Hash size={9} className="shrink-0" />
                        <span className="truncate">{sectionPath(citation)}</span>
                      </span>
                    ) : null}
                    {citation.page ? (
                      <span className="inline-flex items-center gap-1">
                        <FileText size={9} />p.{citation.page}
                      </span>
                    ) : null}
                    <span
                      className="mono"
                      style={{
                        color:
                          citation.score >= 0.7
                            ? "var(--positive)"
                            : citation.score >= 0.45
                              ? "var(--data)"
                              : "var(--text-faint)",
                      }}
                    >
                      {Math.round(citation.score * 100)}%
                    </span>
                    {!citation.used ? (
                      <span className="text-[var(--text-faint)]">not cited</span>
                    ) : null}
                  </p>
                </div>
              </div>

              {activeMarker === citation.marker ? (
                <blockquote className="animate-fade mt-2.5 border-l-2 border-[color:var(--accent)] pl-3 text-[0.75rem] leading-relaxed text-[var(--text-secondary)]">
                  <Quote
                    size={10}
                    className="mb-1 inline text-[var(--text-faint)]"
                    aria-hidden
                  />{" "}
                  {citation.snippet}
                  {citation.snippet.length >= 700 ? "…" : ""}
                </blockquote>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
