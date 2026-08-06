"use client";

import Link from "next/link";
import { Activity, Coins, Gauge, ShieldCheck, Sparkles, Zap } from "lucide-react";

import { LiveDot } from "@/components/ui/Badge";
import type { Provider } from "@/lib/types";
import { cn, formatDuration, formatUsd } from "@/lib/utils";

const ACCENT: Record<string, string> = {
  accent: "var(--accent)",
  data: "var(--data)",
  value: "var(--value)",
  positive: "var(--positive)",
  danger: "var(--danger)",
};

export function accentColor(accent: string): string {
  return ACCENT[accent] ?? "var(--accent)";
}

/** Grade drives colour so trust is readable at a glance across the grid. */
function gradeTone(grade: string): string {
  if (grade.startsWith("AAA")) return "var(--positive)";
  if (grade.startsWith("AA")) return "var(--data)";
  if (grade.startsWith("A")) return "var(--accent)";
  if (grade.startsWith("BBB")) return "var(--value)";
  return "var(--text-muted)";
}

export function ProviderCard({
  provider,
  selected,
  highlight,
  onSelect,
  compact,
}: {
  provider: Provider;
  selected?: boolean;
  /** Rendered when this provider is the routing agent's pick. */
  highlight?: string;
  onSelect?: (slug: string) => void;
  compact?: boolean;
}) {
  const tone = accentColor(provider.accent);
  const { stats, reputation } = provider;
  const online = provider.status === "online";

  return (
    <article
      className={cn(
        "panel group relative flex h-full flex-col overflow-hidden p-4 transition-all duration-200",
        selected
          ? "border-[color:var(--line-accent)] shadow-[var(--shadow-glow)]"
          : "hover:border-[color:var(--line-strong)] hover:shadow-[var(--shadow-md)]",
        !online && "opacity-60",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full opacity-[0.13] blur-2xl transition-opacity duration-300 group-hover:opacity-25"
        style={{ background: tone }}
      />

      {highlight ? (
        <div
          className="mb-3 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[0.6875rem] font-semibold"
          style={{
            background: "color-mix(in oklab, var(--accent) 14%, transparent)",
            color: "var(--accent-strong)",
          }}
        >
          <Sparkles size={11} />
          {highlight}
        </div>
      ) : null}

      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div className="relative flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius)] text-sm font-bold"
          style={{
            background: `color-mix(in oklab, ${tone} 15%, transparent)`,
            color: tone,
          }}
        >
          {provider.name.slice(0, 2).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--text)]">
              {provider.name}
            </h3>
            <span
              className="flex shrink-0 items-center gap-1 text-[0.625rem]"
              style={{ color: online ? "var(--positive)" : "var(--danger)" }}
            >
              <LiveDot tone={online ? "positive" : "danger"} />
              {provider.status}
            </span>
          </div>
          <p className="truncate text-xs text-[var(--text-muted)]">
            {provider.tagline}
          </p>
        </div>

        <span
          className="mono shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] font-semibold"
          style={{
            background: `color-mix(in oklab, ${gradeTone(reputation.grade)} 14%, transparent)`,
            color: gradeTone(reputation.grade),
          }}
          title={`Trust ${Math.round(reputation.trust * 100)}% over ${reputation.observations} calls`}
        >
          {reputation.grade}
        </span>
      </div>

      {/* ── Metrics ──────────────────────────────────────────────────────── */}
      <dl className="relative mt-4 grid grid-cols-3 gap-2">
        <Metric
          icon={<Coins size={11} />}
          label="Price"
          value={`${provider.price_xlm} XLM`}
          sub={formatUsd(provider.price_usd)}
          tone="var(--value)"
        />
        <Metric
          icon={<Gauge size={11} />}
          label="Latency"
          value={
            stats.avg_latency_ms
              ? formatDuration(stats.avg_latency_ms)
              : `~${formatDuration(provider.target_latency_ms)}`
          }
          sub={stats.avg_latency_ms ? "measured" : "advertised"}
          tone="var(--data)"
        />
        <Metric
          icon={<ShieldCheck size={11} />}
          label="Trust"
          value={`${Math.round(reputation.trust * 100)}%`}
          sub={
            reputation.unproven
              ? "unproven"
              : `${reputation.observations} calls`
          }
          tone={gradeTone(reputation.grade)}
        />
      </dl>

      {/* ── Trust bar ────────────────────────────────────────────────────── */}
      <div className="relative mt-3">
        <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-active)]">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${reputation.trust * 100}%`,
              background: gradeTone(reputation.grade),
            }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[0.625rem] text-[var(--text-faint)]">
          <span>
            {stats.reliability !== null
              ? `${Math.round(stats.reliability * 100)}% reliable`
              : "no traffic yet"}
          </span>
          <span className="flex items-center gap-1">
            <Activity size={9} />
            {stats.total_requests} requests
          </span>
        </div>
      </div>

      {/* ── Capabilities ─────────────────────────────────────────────────── */}
      {!compact ? (
        <div className="relative mt-3 flex flex-wrap gap-1">
          {provider.capabilities.slice(0, 4).map((capability) => (
            <span
              key={capability}
              className="rounded border border-[color:var(--line)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[0.625rem] text-[var(--text-muted)]"
            >
              {capability}
            </span>
          ))}
        </div>
      ) : null}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="relative mt-auto flex items-center gap-2 pt-4">
        <Link
          href={`/marketplace/${provider.slug}`}
          className="btn btn-secondary btn-sm flex-1"
        >
          Inspect
        </Link>
        {onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(provider.slug)}
            className={cn(
              "btn btn-sm flex-1",
              selected ? "btn-primary" : "btn-secondary",
            )}
          >
            {selected ? "Selected" : "Compare"}
          </button>
        ) : (
          <span className="mono flex items-center gap-1 text-[0.625rem] text-[var(--text-faint)]">
            <Zap size={9} />
            {provider.credits_per_call} cr
          </span>
        )}
      </div>
    </article>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: string;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[var(--surface-raised)] p-2">
      <dt
        className="flex items-center gap-1 text-[0.5625rem] font-semibold uppercase tracking-[0.06em]"
        style={{ color: tone }}
      >
        {icon}
        {label}
      </dt>
      <dd className="text-numeric mt-1 truncate text-xs font-semibold text-[var(--text)]">
        {value}
      </dd>
      {sub ? (
        <dd className="truncate text-[0.5625rem] text-[var(--text-faint)]">{sub}</dd>
      ) : null}
    </div>
  );
}
