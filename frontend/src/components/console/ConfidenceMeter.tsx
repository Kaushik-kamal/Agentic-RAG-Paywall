"use client";

import { useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";

import type { Confidence } from "@/lib/types";
import { cn } from "@/lib/utils";

function toneFor(score: number): { color: string; track: string } {
  if (score >= 0.78) return { color: "var(--positive)", track: "var(--positive-soft)" };
  if (score >= 0.55) return { color: "var(--data)", track: "var(--data-soft)" };
  if (score >= 0.3) return { color: "var(--value)", track: "var(--value-soft)" };
  return { color: "var(--danger)", track: "var(--danger-soft)" };
}

/** Confidence is derived from retrieval evidence and citation coverage, so the
 *  reasons behind the number are worth showing — that is what makes it
 *  trustworthy rather than decorative. */
export function ConfidenceMeter({
  confidence,
  compact,
}: {
  confidence: Confidence;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { color, track } = toneFor(confidence.score);
  const circumference = 2 * Math.PI * 15;

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-medium"
        style={{ color }}
        title={confidence.label}
      >
        <ShieldCheck size={12} />
        {confidence.percent}%
      </span>
    );
  }

  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--line)] bg-[var(--surface-raised)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span className="relative grid h-11 w-11 shrink-0 place-items-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke={track}
              strokeWidth="3"
            />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - confidence.score)}
              style={{ transition: "stroke-dashoffset 700ms var(--ease-out)" }}
            />
          </svg>
          <span
            className="text-numeric text-[0.6875rem] font-semibold"
            style={{ color }}
          >
            {confidence.percent}
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] font-medium" style={{ color }}>
            {confidence.label}
          </span>
          <span className="block truncate text-xs text-[var(--text-muted)]">
            {confidence.reasons[0] ?? "Scored from retrieval evidence"}
          </span>
        </span>

        <ChevronDown
          size={15}
          className={cn(
            "shrink-0 text-[var(--text-faint)] transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <ul className="animate-fade space-y-1.5 border-t border-[color:var(--line)] px-3 py-3 text-xs leading-relaxed text-[var(--text-muted)]">
          {confidence.reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--text-faint)]" />
              {reason}
            </li>
          ))}
          <li className="pt-1.5 text-[var(--text-faint)]">
            Computed from retrieval similarity and citation coverage — not from
            the model&rsquo;s own self-assessment.
          </li>
        </ul>
      ) : null}
    </div>
  );
}
