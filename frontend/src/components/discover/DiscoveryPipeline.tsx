"use client";

/** The routing pipeline, animated from real events.
 *
 * Each stage lights up when its event arrives from the server and carries the
 * actual numbers — provider counts, scores, prices, elapsed milliseconds. The
 * animation is driven by the network, not by a timer, so it cannot show a step
 * that did not happen.
 */

import {
  Brain,
  CheckCircle2,
  Coins,
  Filter,
  ListOrdered,
  Radar,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";

import { LiveDot } from "@/components/ui/Badge";
import { cn, formatDuration } from "@/lib/utils";

export type StageId =
  | "intent"
  | "discovered"
  | "ranked"
  | "selected"
  | "payment"
  | "invoking"
  | "answering"
  | "done";

export interface Stage {
  id: StageId;
  label: string;
  detail?: string;
  state: "idle" | "active" | "done" | "failed";
  elapsedMs?: number;
}

const ICONS: Record<StageId, typeof Radar> = {
  intent: Brain,
  discovered: Radar,
  ranked: ListOrdered,
  selected: Target,
  payment: Coins,
  invoking: Filter,
  answering: Sparkles,
  done: CheckCircle2,
};

export const BLUEPRINT: { id: StageId; label: string }[] = [
  { id: "intent", label: "Understanding intent" },
  { id: "discovered", label: "Searching the marketplace" },
  { id: "ranked", label: "Filtering and ranking" },
  { id: "selected", label: "Choosing a provider" },
  { id: "payment", label: "Settling payment" },
  { id: "invoking", label: "Calling the provider" },
  { id: "answering", label: "Receiving the answer" },
];

export function DiscoveryPipeline({
  stages,
  totalMs,
}: {
  stages: Stage[];
  totalMs?: number;
}) {
  return (
    <ol className="relative space-y-1">
      {/* Spine */}
      <div
        aria-hidden
        className="absolute bottom-4 left-[0.9375rem] top-4 w-px bg-[color:var(--line)]"
      />

      {stages.map((stage) => {
        const Icon = ICONS[stage.id];
        const active = stage.state === "active";
        const done = stage.state === "done";
        const failed = stage.state === "failed";

        return (
          <li key={stage.id} className="relative flex gap-3 py-1.5">
            <span
              className={cn(
                "relative z-10 grid h-[1.875rem] w-[1.875rem] shrink-0 place-items-center rounded-full border transition-all duration-300",
                active &&
                  "border-[color:var(--line-accent)] bg-[var(--accent-soft)] shadow-[var(--shadow-glow)]",
                done && "border-[color:var(--positive)]/40 bg-[var(--positive-soft)]",
                failed && "border-[color:var(--danger)]/40 bg-[var(--danger-soft)]",
                stage.state === "idle" &&
                  "border-[color:var(--line)] bg-[var(--surface)]",
              )}
            >
              {failed ? (
                <XCircle size={14} className="text-[var(--danger)]" />
              ) : done ? (
                <CheckCircle2 size={14} className="text-[var(--positive)]" />
              ) : active ? (
                <LiveDot tone="accent" />
              ) : (
                <Icon size={13} className="text-[var(--text-faint)]" />
              )}
            </span>

            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-baseline gap-2">
                <p
                  className={cn(
                    "text-[0.8125rem] font-medium transition-colors",
                    active
                      ? "text-[var(--accent-strong)]"
                      : done
                        ? "text-[var(--text)]"
                        : failed
                          ? "text-[var(--danger)]"
                          : "text-[var(--text-faint)]",
                  )}
                >
                  {stage.label}
                </p>
                {stage.elapsedMs !== undefined ? (
                  <span className="mono shrink-0 text-[0.625rem] text-[var(--text-faint)]">
                    {formatDuration(stage.elapsedMs)}
                  </span>
                ) : null}
              </div>
              {stage.detail ? (
                <p
                  className={cn(
                    "animate-fade mt-0.5 text-xs leading-relaxed",
                    failed ? "text-[var(--danger)]" : "text-[var(--text-muted)]",
                  )}
                >
                  {stage.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}

      {totalMs !== undefined ? (
        <li className="animate-rise relative flex gap-3 pt-2">
          <span className="relative z-10 grid h-[1.875rem] w-[1.875rem] shrink-0 place-items-center rounded-full border border-[color:var(--line-accent)] bg-[var(--accent-soft)]">
            <Sparkles size={13} className="text-[var(--accent-strong)]" />
          </span>
          <p className="pt-1.5 text-[0.8125rem] text-[var(--text)]">
            Discovery to paid answer in{" "}
            <strong className="text-numeric">{formatDuration(totalMs)}</strong> — the
            agent had never seen this provider before.
          </p>
        </li>
      ) : null}
    </ol>
  );
}
