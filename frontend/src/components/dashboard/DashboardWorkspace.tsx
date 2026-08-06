"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Coins,
  Cpu,
  Database,
  ExternalLink,
  Gauge,
  Landmark,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";

import { AreaChart, BarChart } from "@/components/charts/Charts";
import { Badge, LiveDot } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader, StatTile } from "@/components/ui/Card";
import { EmptyState, OfflineBanner, Skeleton } from "@/components/ui/Feedback";
import { Purpose } from "@/components/ui/Purpose";
import { ApiError, getAnalytics, getHealth, getStats, getTreasuryAccount } from "@/lib/api";
import type { Analytics, Health, PlatformStats } from "@/lib/types";
import {
  cn,
  formatCount,
  formatDuration,
  formatRelative,
  formatUsd,
  formatXlm,
  shortHash,
  truncate,
} from "@/lib/utils";

const REFRESH_MS = 15_000;

interface Treasury {
  status: string;
  network: string;
  configured: boolean;
  public_key: string | null;
  balance_xlm?: number;
  explorer_url: string | null;
  sandbox_mode: boolean;
  detail?: string;
}

export function DashboardWorkspace() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Every state update lands after the await, so mounting costs one render
  // rather than two. The Refresh button raises the spinner itself.
  const load = useCallback(async () => {
    const [statsResult, analyticsResult, healthResult, treasuryResult] =
      await Promise.allSettled([
        getStats(),
        getAnalytics(14),
        getHealth(),
        getTreasuryAccount(),
      ]);

    if (statsResult.status === "fulfilled") {
      setStats(statsResult.value);
      setOffline(false);
    } else if (
      statsResult.reason instanceof ApiError &&
      statsResult.reason.isNetworkFailure
    ) {
      setOffline(true);
    }
    if (analyticsResult.status === "fulfilled") setAnalytics(analyticsResult.value);
    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    if (treasuryResult.status === "fulfilled") setTreasury(treasuryResult.value);

    setLoading(false);
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    // `load` only updates state after awaiting the network; the rule cannot
    // see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const queriesSeries = (analytics?.queries_by_day ?? []).map((point) => ({
    label: new Date(point.day).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
    }),
    value: point.queries,
  }));

  const revenueSeries = (analytics?.queries_by_day ?? []).map((point) => ({
    label: new Date(point.day).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
    }),
    value: point.revenue_xlm,
  }));

  const hasTraffic = (stats?.total_queries ?? 0) > 0;

  return (
    <div className="shell py-10">
      <SectionHeader
        eyebrow="Platform"
        title="Analytics"
        description="Every number here comes from the API's own ledger and query log — nothing on this page is simulated."
        actions={
          <div className="demo-quiet flex items-center gap-3">
            {updatedAt ? (
              <span className="hidden text-xs text-[var(--text-faint)] sm:block">
                updated {formatRelative(updatedAt.toISOString())}
              </span>
            ) : null}
            <Button
              size="sm"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              icon={<RefreshCw size={14} className={cn(loading && "animate-spin")} />}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <Purpose className="mt-4">
        Real-time health of the AI economy — every figure from the ledger, none
        simulated.
      </Purpose>

      {offline ? <OfflineBanner className="mt-6" /> : null}

      {/* ── Headline metrics ──────────────────────────────────────────────── */}
      <div className="stagger mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Answers delivered"
          value={formatCount(stats?.total_queries ?? 0)}
          sublabel={
            stats
              ? `${Math.round((stats.success_rate ?? 1) * 100)}% success rate`
              : undefined
          }
          icon={<MessageSquare size={16} />}
          loading={loading && !stats}
        />
        <StatTile
          label="Revenue settled"
          value={`${formatXlm(stats?.total_revenue_xlm ?? 0)} XLM`}
          sublabel={stats ? `${formatUsd(stats.revenue_usd)} · ${stats.network}` : undefined}
          icon={<Coins size={16} />}
          accent="value"
          loading={loading && !stats}
        />
        <StatTile
          label="Median latency"
          value={formatDuration(stats?.avg_latency_ms ?? 0)}
          sublabel="retrieval plus generation"
          icon={<Gauge size={16} />}
          accent="data"
          loading={loading && !stats}
        />
        <StatTile
          label="Mean confidence"
          value={`${Math.round((stats?.avg_confidence ?? 0) * 100)}%`}
          sublabel="grounding score across answers"
          icon={<ShieldCheck size={16} />}
          accent="positive"
          loading={loading && !stats}
        />
      </div>

      {/* ── Charts ───────────────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold">Query volume</h3>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Answers billed per day · last 14 days
              </p>
            </div>
            <Badge tone="accent">
              <Activity size={10} />
              {formatCount(stats?.total_queries ?? 0)} total
            </Badge>
          </div>
          {loading && !analytics ? (
            <Skeleton className="h-[180px]" />
          ) : hasTraffic ? (
            <AreaChart data={queriesSeries} format={(v) => `${v} queries`} />
          ) : (
            <EmptyState
              title="No queries yet"
              description="Ask something in the console — this chart fills in from the query log."
              className="py-10"
            />
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold">Revenue</h3>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                XLM earned per day at {stats?.price_xlm ?? 0.01} XLM per answer
              </p>
            </div>
            <Badge tone="value">
              <TrendingUp size={10} />
              {formatXlm(stats?.total_revenue_xlm ?? 0)} XLM
            </Badge>
          </div>
          {loading && !analytics ? (
            <Skeleton className="h-[150px]" />
          ) : hasTraffic ? (
            <BarChart
              data={revenueSeries}
              color="var(--value)"
              format={(v) => `${formatXlm(v, 5)} XLM`}
            />
          ) : (
            <EmptyState
              title="No revenue yet"
              description="Settle an x402 payment from the console or the reference agent."
              className="py-10"
            />
          )}
        </Card>
      </div>

      {/* ── Activity + system ────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card padded={false}>
          <div className="flex items-center justify-between border-b border-[color:var(--line)] px-5 py-3.5">
            <h3 className="text-sm font-semibold">Recent answers</h3>
            <Badge tone="neutral">
              <LiveDot tone={offline ? "danger" : "positive"} />
              live
            </Badge>
          </div>

          {loading && !analytics ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-12" />
              ))}
            </div>
          ) : analytics?.recent_queries.length ? (
            <ul className="divide-y divide-[color:var(--line)]">
              {analytics.recent_queries.slice(0, 8).map((entry) => (
                <li
                  key={entry.query_id}
                  className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background:
                        entry.status === "success"
                          ? "var(--positive)"
                          : "var(--danger)",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--text)]">
                      {entry.question}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-faint)]">
                      {entry.agent_id} · {formatRelative(entry.created_at)}
                      {entry.chunks_used ? ` · ${entry.chunks_used} passages` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {entry.confidence != null ? (
                      <p
                        className="text-numeric text-xs font-medium"
                        style={{
                          color:
                            entry.confidence >= 0.78
                              ? "var(--positive)"
                              : entry.confidence >= 0.55
                                ? "var(--data)"
                                : "var(--value)",
                        }}
                      >
                        {Math.round(entry.confidence * 100)}%
                      </p>
                    ) : null}
                    <p className="text-[0.6875rem] text-[var(--text-faint)]">
                      {formatDuration(entry.latency_ms)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<MessageSquare size={20} />}
              title="No activity yet"
              description="Answers appear here the moment an agent — or you — asks something."
            />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-4 text-sm font-semibold">System health</h3>
            {loading && !health ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-7" />
                ))}
              </div>
            ) : health ? (
              <ul className="space-y-2.5">
                {Object.entries(health.components).map(([name, component]) => (
                  <li key={name} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[0.8125rem] capitalize text-[var(--text-secondary)]">
                      {COMPONENT_ICON[name] ?? <Activity size={13} />}
                      {name.replace(/_/g, " ")}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-[0.6875rem] text-[var(--text-faint)]">
                        {componentDetail(component)}
                      </span>
                      <StatusDot status={component.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">Health unavailable.</p>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Landmark size={14} className="text-[var(--value)]" />
              Stellar treasury
            </h3>
            {treasury?.configured ? (
              <div className="space-y-2.5 text-sm">
                <Row label="Network" value={treasury.network} />
                <Row
                  label="Balance"
                  value={
                    treasury.balance_xlm != null
                      ? `${treasury.balance_xlm.toLocaleString()} XLM`
                      : treasury.status
                  }
                />
                <Row
                  label="Account"
                  value={shortHash(treasury.public_key ?? "", 6)}
                  mono
                />
                <Row
                  label="Sandbox"
                  value={treasury.sandbox_mode ? "enabled" : "disabled"}
                  tone={treasury.sandbox_mode ? "var(--value)" : "var(--positive)"}
                />
                {treasury.explorer_url ? (
                  <a
                    href={treasury.explorer_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 pt-1 text-xs text-[var(--accent-strong)] hover:underline"
                  >
                    View on Stellar Expert
                    <ExternalLink size={11} />
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                No treasury account configured. Run{" "}
                <code className="mono rounded bg-[var(--surface-active)] px-1 py-0.5 text-[var(--data)]">
                  python scripts/setup_stellar.py
                </code>{" "}
                to provision and fund one on the testnet.
              </p>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold">Pipeline</h3>
            <ul className="space-y-2.5 text-sm">
              <Row
                label="Generation"
                value={String(analytics?.pipeline?.generation_model ?? stats?.model ?? "—")}
                mono
              />
              <Row
                label="Embeddings"
                value={String(analytics?.pipeline?.embedding_model ?? "—").replace(
                  "models/",
                  "",
                )}
                mono
              />
              <Row
                label="Retrieval"
                value={String(analytics?.pipeline?.retrieval_strategy ?? "hybrid")}
              />
              <Row label="Indexed vectors" value={formatCount(stats?.indexed_vectors ?? 0)} />
              <Row label="Documents" value={formatCount(stats?.total_documents ?? 0)} />
              <Row label="Registered agents" value={formatCount(stats?.total_agents ?? 0)} />
            </ul>
          </Card>
        </div>
      </div>

      {/* ── Payments + top questions ─────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="border-b border-[color:var(--line)] px-5 py-3.5">
            <h3 className="text-sm font-semibold">Verified payments</h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Every credit sold, with its on-chain transaction
            </p>
          </div>
          {analytics?.recent_payments.length ? (
            <ul className="divide-y divide-[color:var(--line)]">
              {analytics.recent_payments.slice(0, 6).map((payment) => (
                <li key={payment.payment_id} className="flex items-center gap-3 px-5 py-3">
                  <Badge tone={payment.mode === "live" ? "positive" : "neutral"}>
                    {payment.mode === "live" ? <BadgeCheck size={10} /> : null}
                    {payment.mode}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="mono truncate text-xs text-[var(--text-secondary)]">
                      {shortHash(payment.tx_hash, 8)}
                    </p>
                    <p className="truncate text-[0.6875rem] text-[var(--text-faint)]">
                      {payment.agent_id} · {formatRelative(payment.created_at)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-numeric text-xs font-medium text-[var(--value)]">
                      {formatXlm(payment.amount_xlm, 5)} XLM
                    </p>
                    <p className="text-[0.6875rem] text-[var(--text-faint)]">
                      +{payment.credits_granted} credits
                    </p>
                  </div>
                  {payment.explorer_url ? (
                    <a
                      href={payment.explorer_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View transaction on Stellar Expert"
                      className="shrink-0 text-[var(--text-faint)] transition-colors hover:text-[var(--accent-strong)]"
                    >
                      <ExternalLink size={12} />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Coins size={20} />}
              title="No payments yet"
              description="Settle one from the console, or run the reference agent to pay on-chain."
            />
          )}
        </Card>

        <Card padded={false}>
          <div className="border-b border-[color:var(--line)] px-5 py-3.5">
            <h3 className="text-sm font-semibold">Most asked</h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Questions ranked by frequency — a map of what the corpus is used for
            </p>
          </div>
          {analytics?.top_questions.length ? (
            <ul className="divide-y divide-[color:var(--line)]">
              {analytics.top_questions.map((entry, index) => (
                <li key={entry.question} className="flex items-center gap-3 px-5 py-3">
                  <span className="text-numeric w-5 shrink-0 text-xs text-[var(--text-faint)]">
                    {index + 1}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">
                    {truncate(entry.question, 70)}
                  </p>
                  <Badge tone="neutral">{entry.occurrences}×</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Users size={20} />}
              title="Nothing ranked yet"
              description="Popular questions surface here once the query log has data."
            />
          )}
        </Card>
      </div>
    </div>
  );
}

const COMPONENT_ICON: Record<string, React.ReactNode> = {
  api: <Activity size={13} />,
  database: <Database size={13} />,
  vector_store: <Database size={13} />,
  gemini: <Cpu size={13} />,
  stellar: <Coins size={13} />,
};

function componentDetail(component: Record<string, unknown>): string {
  if (typeof component.chunks === "number") return `${component.chunks} chunks`;
  if (typeof component.model === "string")
    return String(component.model).replace("models/", "");
  if (typeof component.network === "string") return String(component.network);
  return String(component.status);
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "ok"
      ? "var(--positive)"
      : status === "unconfigured" || status === "unfunded"
        ? "var(--value)"
        : "var(--danger)";
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
      title={status}
      aria-label={status}
    />
  );
}

function Row({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-[0.8125rem] text-[var(--text-muted)]">{label}</span>
      <span
        className={cn(
          "truncate text-[0.8125rem] text-[var(--text)]",
          mono && "mono text-[0.75rem]",
        )}
        style={tone ? { color: tone } : undefined}
        title={value}
      >
        {value}
      </span>
    </li>
  );
}
