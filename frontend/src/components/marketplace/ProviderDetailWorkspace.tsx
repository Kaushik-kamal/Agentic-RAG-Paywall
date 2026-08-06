"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Blocks,
  Coins,
  Cpu,
  Gauge,
  Network,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { accentColor } from "./ProviderCard";
import { AreaChart } from "@/components/charts/Charts";
import { Badge, LiveDot } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, StatTile } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { ApiError, getProvider } from "@/lib/api";
import type { ProviderDetail } from "@/lib/types";
import { formatCount, formatDuration, formatRelative, formatUsd, formatXlm } from "@/lib/utils";

export function ProviderDetailWorkspace({ slug }: { slug: string }) {
  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setProvider(await getProvider(slug));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not load this provider.",
      );
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    // State lands after the network call resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && !provider) {
    return (
      <div className="shell py-10">
        <Skeleton className="h-10 w-72" />
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="mt-4 h-72" />
      </div>
    );
  }

  if (error || !provider) {
    return (
      <div className="shell py-10">
        <ErrorState
          title="Provider unavailable"
          message={error ?? "This service is not listed on the network."}
          onRetry={() => void load()}
        />
        <ButtonLink href="/marketplace" className="mt-4" icon={<ArrowLeft size={14} />}>
          Back to the marketplace
        </ButtonLink>
      </div>
    );
  }

  const tone = accentColor(provider.accent);
  const { stats, reputation } = provider;

  const trustSeries = provider.reputation_history.map((point) => ({
    label: `call ${point.n}`,
    value: Math.round(point.trust * 100),
  }));

  return (
    <div className="shell py-10">
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
      >
        <ArrowLeft size={13} />
        Marketplace
      </Link>

      <div className="mt-4 flex flex-wrap items-start gap-4">
        <span
          className="grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius-lg)] text-lg font-bold"
          style={{
            background: `color-mix(in oklab, ${tone} 15%, transparent)`,
            color: tone,
          }}
        >
          {provider.name.slice(0, 2).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-title">{provider.name}</h1>
            <Badge tone="neutral">{provider.category}</Badge>
            <span
              className="flex items-center gap-1.5 text-xs"
              style={{
                color:
                  provider.status === "online"
                    ? "var(--positive)"
                    : "var(--danger)",
              }}
            >
              <LiveDot tone={provider.status === "online" ? "positive" : "danger"} />
              {provider.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{provider.tagline}</p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
            {provider.description}
          </p>
        </div>

        <ButtonLink href="/discover" variant="primary" icon={<Network size={14} />}>
          Route a request
        </ButtonLink>
      </div>

      {/* ── Headline metrics ─────────────────────────────────────────────── */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Price per call"
          value={`${provider.price_xlm} XLM`}
          sublabel={`${formatUsd(provider.price_usd)} · ${provider.credits_per_call} credit${provider.credits_per_call === 1 ? "" : "s"}`}
          icon={<Coins size={16} />}
          accent="value"
        />
        <StatTile
          label="Measured latency"
          value={
            stats.avg_latency_ms
              ? formatDuration(stats.avg_latency_ms)
              : `~${formatDuration(provider.target_latency_ms)}`
          }
          sublabel={
            stats.avg_latency_ms
              ? `advertised ${formatDuration(provider.target_latency_ms)}`
              : "advertised, no traffic yet"
          }
          icon={<Gauge size={16} />}
          accent="data"
        />
        <StatTile
          label="Trust score"
          value={`${reputation.grade} · ${Math.round(reputation.trust * 100)}%`}
          sublabel={
            reputation.unproven
              ? "unproven — fewer than 3 calls"
              : `over ${reputation.observations} calls`
          }
          icon={<ShieldCheck size={16} />}
          accent="positive"
        />
        <StatTile
          label="Revenue earned"
          value={`${formatXlm(stats.revenue_xlm, 4)} XLM`}
          sublabel={`${formatCount(stats.total_requests)} requests served`}
          icon={<TrendingUp size={16} />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* ── Reputation over time ───────────────────────────────────────── */}
        <Card>
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold">Reputation over time</h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Replayed cumulatively from the event ledger — never a stored series
              </p>
            </div>
            <Badge tone="accent">
              <Activity size={10} />
              {reputation.observations} events
            </Badge>
          </div>

          {trustSeries.length > 1 ? (
            <AreaChart
              data={trustSeries}
              format={(value) => `${value}% trust`}
              color={tone}
            />
          ) : (
            <EmptyState
              title="Not enough history yet"
              description="Route a request to this provider and its trust score starts forming from the first transaction."
              className="py-10"
            />
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[color:var(--line)] pt-4 sm:grid-cols-4">
            {Object.entries(reputation.components).map(([name, value]) => (
              <div key={name}>
                <p className="text-[0.625rem] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                  {name}
                </p>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--surface-active)]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${value * 100}%`, background: tone }}
                  />
                </div>
                <p className="text-numeric mt-1 text-xs text-[var(--text-secondary)]">
                  {Math.round(value * 100)}%
                  <span className="ml-1 text-[0.625rem] text-[var(--text-faint)]">
                    ×{reputation.weights[name]}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Service card ───────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Blocks size={14} className="text-[var(--accent-strong)]" />
              Declared capabilities
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {provider.capabilities.map((capability) => (
                <span
                  key={capability}
                  className="rounded border border-[color:var(--line)] bg-[var(--surface-raised)] px-2 py-1 text-[0.6875rem] text-[var(--text-secondary)]"
                >
                  {capability}
                </span>
              ))}
            </div>

            <h3 className="text-eyebrow mb-2 mt-4">Intent keywords</h3>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              {provider.keywords.slice(0, 18).join(" · ")}
              {provider.keywords.length > 18
                ? ` · +${provider.keywords.length - 18} more`
                : ""}
            </p>
          </Card>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Cpu size={14} className="text-[var(--data)]" />
              Service configuration
            </h2>
            <dl className="space-y-2 text-xs">
              <Row label="Model" value={provider.model} mono />
              <Row label="Endpoint" value={provider.endpoint} mono />
              <Row label="Knowledge scope" value={`${provider.scope_documents.length} documents`} />
              <Row label="Passages per call" value={String(provider.top_k)} />
              <Row label="Temperature" value={provider.temperature.toFixed(2)} />
              <Row label="Payment" value={`x402 · Stellar · ${provider.price_xlm} XLM`} />
              <Row label="Listed" value={formatRelative(provider.created_at)} />
              {provider.registered_by ? (
                <Row label="Registered by" value={provider.registered_by} />
              ) : null}
            </dl>
          </Card>
        </div>
      </div>

      {/* ── Transaction ledger ───────────────────────────────────────────── */}
      <Card padded={false} className="mt-4">
        <div className="border-b border-[color:var(--line)] px-5 py-3.5">
          <h2 className="text-sm font-semibold">Transaction history</h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Every call this provider has served, and what it earned
          </p>
        </div>
        {provider.recent_events.length ? (
          <ul className="divide-y divide-[color:var(--line)]">
            {provider.recent_events.map((event) => (
              <li key={event.event_id} className="flex items-center gap-3 px-5 py-2.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      event.status === "success"
                        ? "var(--positive)"
                        : "var(--danger)",
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                  {event.query}
                </span>
                {event.confidence !== null ? (
                  <span
                    className="mono shrink-0 text-[0.625rem]"
                    style={{
                      color:
                        event.confidence >= 0.7
                          ? "var(--positive)"
                          : event.confidence >= 0.4
                            ? "var(--data)"
                            : "var(--value)",
                    }}
                  >
                    {Math.round(event.confidence * 100)}%
                  </span>
                ) : null}
                <span className="mono w-16 shrink-0 text-right text-[0.625rem] text-[var(--text-faint)]">
                  {formatDuration(event.latency_ms)}
                </span>
                <span className="mono w-20 shrink-0 text-right text-[0.625rem] text-[var(--value)]">
                  {formatXlm(event.cost_xlm, 3)} XLM
                </span>
                <span className="hidden w-20 shrink-0 text-right text-[0.625rem] text-[var(--text-faint)] sm:block">
                  {formatRelative(event.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Activity size={20} />}
            title="No transactions yet"
            description="This provider has not been routed to. Its reputation sits at the prior until the first real call."
          />
        )}
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd
        className={
          mono
            ? "mono truncate text-[0.6875rem] text-[var(--text)]"
            : "truncate text-[var(--text)]"
        }
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
