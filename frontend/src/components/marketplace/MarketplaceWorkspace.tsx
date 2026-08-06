"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpDown,
  Coins,
  Crown,
  Gauge,
  Network,
  RefreshCw,
  Search,
  Store,
  TrendingDown,
} from "lucide-react";

import { ProviderCard, accentColor } from "./ProviderCard";
import { Badge, Chip, LiveDot } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, SectionHeader, StatTile } from "@/components/ui/Card";
import { EmptyState, OfflineBanner, Skeleton } from "@/components/ui/Feedback";
import { ApiError, getNetworkStats, listProviders } from "@/lib/api";
import type { NetworkStats, Provider } from "@/lib/types";
import { cn, formatCount, formatDuration, formatRelative, formatXlm } from "@/lib/utils";

type SortKey = "trust" | "price" | "latency" | "usage" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "trust", label: "Trust" },
  { key: "price", label: "Price" },
  { key: "latency", label: "Latency" },
  { key: "usage", label: "Usage" },
  { key: "name", label: "Name" },
];

export function MarketplaceWorkspace() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("trust");

  const load = useCallback(async () => {
    const [listing, network] = await Promise.allSettled([
      listProviders(),
      getNetworkStats(),
    ]);
    if (listing.status === "fulfilled") {
      setProviders(listing.value.providers);
      setOffline(false);
    } else if (
      listing.reason instanceof ApiError &&
      listing.reason.isNetworkFailure
    ) {
      setOffline(true);
    }
    if (network.status === "fulfilled") setStats(network.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Updates land after the network call resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 12_000);
    return () => clearInterval(timer);
  }, [load]);

  const categories = useMemo(
    () => Array.from(new Set(providers.map((p) => p.category))).sort(),
    [providers],
  );

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = providers.filter((provider) => {
      if (category && provider.category !== category) return false;
      if (!needle) return true;
      return `${provider.name} ${provider.tagline} ${provider.description} ${provider.capabilities.join(" ")} ${provider.keywords.join(" ")}`
        .toLowerCase()
        .includes(needle);
    });

    const comparators: Record<SortKey, (a: Provider, b: Provider) => number> = {
      trust: (a, b) => b.reputation.trust - a.reputation.trust,
      price: (a, b) => a.price_xlm - b.price_xlm,
      latency: (a, b) =>
        (a.stats.avg_latency_ms ?? a.target_latency_ms) -
        (b.stats.avg_latency_ms ?? b.target_latency_ms),
      usage: (a, b) => b.stats.total_requests - a.stats.total_requests,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...filtered].sort(comparators[sort]);
  }, [providers, filter, category, sort]);

  const board = stats?.leaderboard;

  return (
    <div className="shell py-10">
      <SectionHeader
        eyebrow="Agent Discovery Network"
        title={
          <>
            The <span className="text-gradient">provider marketplace</span>
          </>
        }
        description="Every service publishes its price, latency, capabilities and payment terms. Agents arrive knowing none of them, read this registry, and decide for themselves."
        actions={
          <div className="flex items-center gap-2">
            <ButtonLink href="/discover" variant="primary" icon={<Network size={14} />}>
              Route a request
            </ButtonLink>
            <Button size="sm" onClick={() => void load()} icon={<RefreshCw size={14} />}>
              Refresh
            </Button>
          </div>
        }
      />

      {offline ? <OfflineBanner className="mt-6" /> : null}

      {/* ── Network vitals ───────────────────────────────────────────────── */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Providers online"
          value={`${stats?.providers_online ?? 0}/${stats?.providers_total ?? 0}`}
          sublabel={`${stats?.categories.length ?? 0} categories`}
          icon={<Store size={16} />}
          loading={loading && !stats}
        />
        <StatTile
          label="Requests routed"
          value={formatCount(stats?.total_requests ?? 0)}
          sublabel={
            stats?.success_rate != null
              ? `${Math.round(stats.success_rate * 100)}% success`
              : "no traffic yet"
          }
          icon={<Activity size={16} />}
          accent="data"
          loading={loading && !stats}
        />
        <StatTile
          label="Network revenue"
          value={`${formatXlm(stats?.revenue_xlm ?? 0, 4)} XLM`}
          sublabel={`avg price ${formatXlm(stats?.avg_price_xlm ?? 0, 4)} XLM`}
          icon={<Coins size={16} />}
          accent="value"
          loading={loading && !stats}
        />
        <StatTile
          label="Mean latency"
          value={
            stats?.avg_latency_ms ? formatDuration(stats.avg_latency_ms) : "—"
          }
          sublabel="across all providers"
          icon={<Gauge size={16} />}
          accent="positive"
          loading={loading && !stats}
        />
      </div>

      {/* ── Leaderboard ──────────────────────────────────────────────────── */}
      {board ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Rank
            icon={<Crown size={13} />}
            label="Most trusted"
            entry={board.most_trusted}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Rank
            icon={<Activity size={13} />}
            label="Most used"
            entry={board.most_used}
            format={(v) => `${v} calls`}
          />
          <Rank
            icon={<TrendingDown size={13} />}
            label="Cheapest"
            entry={board.cheapest}
            format={(v) => `${formatXlm(-v, 4)} XLM`}
          />
          <Rank
            icon={<Gauge size={13} />}
            label="Fastest"
            entry={board.fastest}
            format={(v) => formatDuration(-v)}
          />
        </div>
      ) : null}

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search capabilities, topics, or providers…"
            aria-label="Search providers"
            className="field pl-10 text-sm"
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <ArrowUpDown size={13} />
          {SORTS.map((option) => (
            <Chip
              key={option.key}
              active={sort === option.key}
              onClick={() => setSort(option.key)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={category === null} onClick={() => setCategory(null)}>
          All {providers.length}
        </Chip>
        {categories.map((name) => (
          <Chip
            key={name}
            active={category === name}
            onClick={() => setCategory(category === name ? null : name)}
          >
            {name}
          </Chip>
        ))}
      </div>

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      {loading && providers.length === 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-64" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card className="mt-5">
          <EmptyState
            icon={<Store size={22} />}
            title="No providers match"
            description={
              providers.length
                ? "Try a different search term or category."
                : "The network is empty. Seed it with `python scripts/seed_marketplace.py`."
            }
          />
        </Card>
      ) : (
        <ul className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((provider) => (
            <li key={provider.provider_id}>
              <ProviderCard provider={provider} />
            </li>
          ))}
        </ul>
      )}

      {/* ── Live activity ────────────────────────────────────────────────── */}
      {stats?.recent_events.length ? (
        <Card padded={false} className="mt-6">
          <div className="flex items-center justify-between border-b border-[color:var(--line)] px-5 py-3.5">
            <h3 className="text-sm font-semibold">Network activity</h3>
            <Badge tone="neutral">
              <LiveDot tone="positive" />
              live
            </Badge>
          </div>
          <ul className="divide-y divide-[color:var(--line)]">
            {stats.recent_events.slice(0, 8).map((event) => (
              <li
                key={event.event_id}
                className="flex items-center gap-3 px-5 py-2.5 text-sm"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: accentColor(event.provider_accent) }}
                />
                <span className="w-40 shrink-0 truncate text-xs font-medium text-[var(--text)]">
                  {event.provider_name}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-muted)]">
                  {event.query}
                </span>
                <span className="mono shrink-0 text-[0.625rem] text-[var(--value)]">
                  {formatXlm(event.cost_xlm, 3)} XLM
                </span>
                <span className="mono hidden w-16 shrink-0 text-right text-[0.625rem] text-[var(--text-faint)] sm:block">
                  {formatDuration(event.latency_ms)}
                </span>
                <span className="hidden w-20 shrink-0 text-right text-[0.625rem] text-[var(--text-faint)] md:block">
                  {formatRelative(event.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="mt-6 text-center text-xs leading-relaxed text-[var(--text-faint)]">
        Providers share infrastructure in this deployment but own{" "}
        <strong className="text-[var(--text-muted)]">disjoint knowledge scopes</strong>,
        set their own prices, and are scored independently — routing to the wrong one
        really does return &ldquo;not in my sources&rdquo;.
      </p>
    </div>
  );
}

function Rank({
  icon,
  label,
  entry,
  format,
}: {
  icon: React.ReactNode;
  label: string;
  entry: { slug: string; name: string; accent: string; value: number } | null;
  format: (value: number) => string;
}) {
  return (
    <div className="panel flex items-center gap-3 p-3">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)]"
        style={{
          background: entry
            ? `color-mix(in oklab, ${accentColor(entry.accent)} 14%, transparent)`
            : "var(--surface-active)",
          color: entry ? accentColor(entry.accent) : "var(--text-faint)",
        }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.625rem] uppercase tracking-[0.08em] text-[var(--text-faint)]">
          {label}
        </p>
        <p
          className={cn(
            "truncate text-xs font-medium",
            entry ? "text-[var(--text)]" : "text-[var(--text-faint)]",
          )}
        >
          {entry?.name ?? "awaiting traffic"}
        </p>
      </div>
      {entry ? (
        <span className="mono shrink-0 text-[0.6875rem] text-[var(--text-muted)]">
          {format(entry.value)}
        </span>
      ) : null}
    </div>
  );
}
