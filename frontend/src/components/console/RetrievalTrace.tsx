"use client";

/** Shows the retrieval that produced an answer: what each retriever ranked,
 *  how fusion reordered it, and why a candidate was dropped. */

import { useState } from "react";
import { Binary, Filter, Layers, Sparkles } from "lucide-react";

import type { RetrievalCandidate, RetrievalTrace as Trace } from "@/lib/types";
import { cn, formatDuration, truncate } from "@/lib/utils";

const REJECTION_LABEL: Record<string, string> = {
  low_relevance: "Below relevance floor",
  near_duplicate: "Near-duplicate of a kept passage",
  document_diversity_cap: "Document already well represented",
  below_cutoff: "Outside top-k",
  filtered_by_document: "Excluded by document filter",
};

export function RetrievalTrace({
  trace,
  candidates,
  retrievalMs,
}: {
  trace: Trace;
  candidates: RetrievalCandidate[];
  retrievalMs?: number;
}) {
  const [showAll, setShowAll] = useState(false);

  const ranked = [...candidates].sort((a, b) => b.fused_score - a.fused_score);
  const visible = showAll ? ranked.slice(0, 24) : ranked.slice(0, 8);
  const maxFused = ranked[0]?.fused_score || 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stage
          icon={<Binary size={13} />}
          label="Dense"
          value={trace.dense_candidates}
          caption="vector matches"
          tone="var(--accent)"
        />
        <Stage
          icon={<Sparkles size={13} />}
          label="Lexical"
          value={trace.lexical_candidates}
          caption="BM25 matches"
          tone="var(--data)"
        />
        <Stage
          icon={<Layers size={13} />}
          label="Fused"
          value={trace.fused_candidates ?? ranked.length}
          caption="after RRF"
          tone="var(--value)"
        />
        <Stage
          icon={<Filter size={13} />}
          label="Selected"
          value={trace.selected ?? ranked.filter((c) => c.selected).length}
          caption="sent to the model"
          tone="var(--positive)"
        />
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        <span className="capitalize text-[var(--text-secondary)]">{trace.strategy}</span>{" "}
        search over {trace.corpus_chunks.toLocaleString()} indexed chunks
        {trace.timings_ms?.dense_ms
          ? ` · dense ${formatDuration(trace.timings_ms.dense_ms)}`
          : ""}
        {trace.timings_ms?.lexical_ms
          ? ` · lexical ${formatDuration(trace.timings_ms.lexical_ms)}`
          : ""}
        {retrievalMs ? ` · total ${formatDuration(retrievalMs)}` : ""}
      </p>

      <ol className="space-y-1.5">
        {visible.map((candidate) => (
          <li key={candidate.chunk_id}>
            <div
              className={cn(
                "group relative overflow-hidden rounded-[var(--radius-sm)] border px-3 py-2 transition-colors",
                candidate.selected
                  ? "border-[color:var(--line-accent)] bg-[var(--accent-soft)]"
                  : "border-[color:var(--line)] bg-[var(--surface-raised)]",
              )}
            >
              {/* Bar length encodes the fused score. */}
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 opacity-[0.13] transition-all duration-500"
                style={{
                  width: `${Math.max(4, (candidate.fused_score / maxFused) * 100)}%`,
                  background: candidate.selected ? "var(--accent)" : "var(--text-faint)",
                }}
              />
              <div className="relative flex items-start gap-2.5">
                <span
                  className={cn(
                    "mono mt-0.5 shrink-0 rounded px-1 text-[0.625rem]",
                    candidate.selected
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--surface-active)] text-[var(--text-faint)]",
                  )}
                >
                  {candidate.selected ? "✓" : "·"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[var(--text)]">
                    {candidate.locator}
                  </p>
                  <p className="mt-0.5 truncate text-[0.6875rem] text-[var(--text-muted)]">
                    {truncate(candidate.preview.replace(/\s+/g, " "), 110)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.625rem] text-[var(--text-faint)]">
                    {candidate.dense_rank !== null ? (
                      <span>
                        dense #{candidate.dense_rank + 1} ·{" "}
                        {Math.round(candidate.dense_score * 100)}%
                      </span>
                    ) : (
                      <span className="opacity-60">dense —</span>
                    )}
                    {candidate.lexical_rank !== null ? (
                      <span className="text-[var(--data)]">
                        bm25 #{candidate.lexical_rank + 1} ·{" "}
                        {Math.round(candidate.lexical_score * 100)}%
                      </span>
                    ) : (
                      <span className="opacity-60">bm25 —</span>
                    )}
                    <span className="mono">rrf {candidate.fused_score.toFixed(4)}</span>
                    {candidate.rejected_reason ? (
                      <span className="text-[var(--value)]">
                        {REJECTION_LABEL[candidate.rejected_reason] ??
                          candidate.rejected_reason}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {ranked.length > 8 ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="text-xs font-medium text-[var(--accent-strong)] hover:underline"
        >
          {showAll
            ? "Show fewer candidates"
            : `Show ${Math.min(ranked.length, 24) - 8} more candidates`}
        </button>
      ) : null}
    </div>
  );
}

function Stage({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  caption: string;
  tone: string;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[var(--surface-raised)] p-2.5">
      <div className="flex items-center gap-1.5" style={{ color: tone }}>
        {icon}
        <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em]">
          {label}
        </span>
      </div>
      <p className="text-numeric mt-1 text-lg font-semibold leading-none text-[var(--text)]">
        {value}
      </p>
      <p className="mt-1 text-[0.625rem] text-[var(--text-faint)]">{caption}</p>
    </div>
  );
}
