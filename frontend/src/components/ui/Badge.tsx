"use client";

import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "data" | "value" | "positive" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "border-[color:var(--line)] bg-[var(--surface-raised)] text-[var(--text-secondary)]",
  accent:
    "border-[color:var(--line-accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]",
  data: "border-[color:var(--data)]/30 bg-[var(--data-soft)] text-[var(--data)]",
  value: "border-[color:var(--value)]/30 bg-[var(--value-soft)] text-[var(--value)]",
  positive:
    "border-[color:var(--positive)]/30 bg-[var(--positive-soft)] text-[var(--positive)]",
  danger: "border-[color:var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger)]",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...rest
}: { tone?: Tone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]",
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export function Chip({
  active,
  className,
  children,
  ...rest
}: { active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "chip cursor-pointer",
        active
          ? "border-[color:var(--line-accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
          : "hover:border-[color:var(--line-strong)] hover:text-[var(--text)]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function LiveDot({ tone = "positive" }: { tone?: Tone }) {
  const color = {
    neutral: "var(--text-muted)",
    accent: "var(--accent)",
    data: "var(--data)",
    value: "var(--value)",
    positive: "var(--positive)",
    danger: "var(--danger)",
  }[tone];
  return <span className="live-dot" style={{ color }} aria-hidden />;
}
