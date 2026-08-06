"use client";

import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds the gradient hairline edge used for hero surfaces. */
  lit?: boolean;
  interactive?: boolean;
  padded?: boolean;
}

export function Card({
  lit,
  interactive,
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "panel relative",
        padded && "p-5",
        lit && "edge-lit",
        interactive &&
          "transition-all duration-200 hover:border-[color:var(--line-strong)] hover:shadow-[var(--shadow-md)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="text-eyebrow mb-2">{eyebrow}</p> : null}
        <h2 className="text-heading text-[var(--text)]">{title}</h2>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sublabel,
  icon,
  accent = "accent",
  trend,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: "accent" | "data" | "value" | "positive";
  trend?: React.ReactNode;
  loading?: boolean;
}) {
  const tone = {
    accent: "var(--accent)",
    data: "var(--data)",
    value: "var(--value)",
    positive: "var(--positive)",
  }[accent];

  return (
    <div className="panel group relative overflow-hidden p-4">
      {/* Tinted wash keyed to the metric's semantic colour. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-[0.14] blur-2xl transition-opacity duration-300 group-hover:opacity-25"
        style={{ background: tone }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] font-medium text-[var(--text-muted)]">
            {label}
          </p>
          {loading ? (
            <div className="skeleton mt-2 h-8 w-24" />
          ) : (
            <p className="text-numeric mt-1.5 text-[1.75rem] font-semibold leading-none tracking-tight text-[var(--text)]">
              {value}
            </p>
          )}
          {sublabel ? (
            <p className="mt-2 truncate text-xs text-[var(--text-faint)]">{sublabel}</p>
          ) : null}
        </div>
        {icon ? (
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)]"
            style={{ background: `color-mix(in oklab, ${tone} 14%, transparent)`, color: tone }}
          >
            {icon}
          </span>
        ) : null}
      </div>
      {trend ? <div className="relative mt-3">{trend}</div> : null}
    </div>
  );
}
