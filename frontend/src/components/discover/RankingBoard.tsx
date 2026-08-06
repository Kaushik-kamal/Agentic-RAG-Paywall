"use client";

/** The scoreboard the routing agent actually used.
 *
 * Every provider it considered, with the score components that produced the
 * decision and — critically — the reason each rejected candidate was rejected.
 * A router you cannot audit is a router you cannot trust.
 */

import { Ban, Crown, Medal } from "lucide-react";

import { accentColor } from "@/components/marketplace/ProviderCard";
import type { RouteCandidate } from "@/lib/types";
import { cn, formatDuration, formatXlm } from "@/lib/utils";

export function RankingBoard({
  candidates,
  chosenSlug,
  runnerUpSlug,
  weights,
}: {
  candidates: RouteCandidate[];
  chosenSlug?: string | null;
  runnerUpSlug?: string | null;
  weights?: Record<string, number>;
}) {
  if (!candidates.length) return null;

  const best = Math.max(...candidates.map((c) => c.scores.total), 0.0001);

  return (
    <div className="space-y-2">
      {weights ? (
        <p className="text-[0.6875rem] text-[var(--text-faint)]">
          Capability sets the ceiling; trust {Math.round(weights.trust * 100)}%,
          price {Math.round(weights.price * 100)}% and latency{" "}
          {Math.round(weights.latency * 100)}% compete within it.
        </p>
      ) : null}

      <ol className="space-y-1.5">
        {candidates.map((candidate, index) => {
          const chosen = candidate.slug === chosenSlug;
          const runnerUp = candidate.slug === runnerUpSlug;
          const tone = accentColor(candidate.accent);

          return (
            <li key={candidate.provider_id}>
              <div
                className={cn(
                  "relative overflow-hidden rounded-[var(--radius-sm)] border px-3 py-2 transition-all duration-300",
                  chosen
                    ? "border-[color:var(--line-accent)] bg-[var(--accent-soft)]"
                    : candidate.eligible
                      ? "border-[color:var(--line)] bg-[var(--surface-raised)]"
                      : "border-[color:var(--line)] bg-[var(--surface)] opacity-55",
                )}
              >
                {/* Bar length encodes the final score. */}
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 opacity-[0.12] transition-all duration-700"
                  style={{
                    width: `${Math.max(3, (candidate.scores.total / best) * 100)}%`,
                    background: candidate.eligible ? tone : "var(--text-faint)",
                  }}
                />

                <div className="relative flex items-center gap-2.5">
                  <span className="mono w-4 shrink-0 text-[0.625rem] text-[var(--text-faint)]">
                    {candidate.eligible ? index + 1 : "—"}
                  </span>

                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: tone }}
                  />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-[var(--text)]">
                        {candidate.name}
                      </span>
                      {chosen ? (
                        <Crown size={11} className="shrink-0 text-[var(--accent-strong)]" />
                      ) : runnerUp ? (
                        <Medal size={11} className="shrink-0 text-[var(--text-faint)]" />
                      ) : null}
                      {!candidate.eligible ? (
                        <Ban size={10} className="shrink-0 text-[var(--text-faint)]" />
                      ) : null}
                    </span>

                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.625rem] text-[var(--text-faint)]">
                      <span
                        style={{
                          color:
                            candidate.scores.capability > 0.6
                              ? "var(--positive)"
                              : undefined,
                        }}
                      >
                        match {Math.round(candidate.scores.capability * 100)}%
                      </span>
                      <span>trust {Math.round(candidate.scores.trust * 100)}%</span>
                      <span className="text-[var(--value)]">
                        {formatXlm(candidate.price_xlm, 3)} XLM
                      </span>
                      <span>{formatDuration(candidate.target_latency_ms)}</span>
                      {candidate.matched_keywords.length ? (
                        <span className="truncate text-[var(--data)]">
                          {candidate.matched_keywords.slice(0, 2).join(", ")}
                        </span>
                      ) : null}
                      {candidate.reason ? (
                        <span className="text-[var(--value)]">{candidate.reason}</span>
                      ) : null}
                    </span>
                  </span>

                  <span
                    className={cn(
                      "mono shrink-0 text-[0.6875rem]",
                      chosen
                        ? "font-semibold text-[var(--accent-strong)]"
                        : "text-[var(--text-muted)]",
                    )}
                  >
                    {candidate.scores.total.toFixed(3)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
