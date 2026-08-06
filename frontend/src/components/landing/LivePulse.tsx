"use client";

/** Live platform numbers under the hero.
 *
 * These are read from the running API rather than hard-coded, which is the
 * point: the landing page is telling the truth about the deployment a visitor
 * is looking at. When the backend is down it says so instead of inventing
 * plausible figures. */

import { useEffect, useState } from "react";
import { Coins, Database, Gauge, MessageSquare } from "lucide-react";

import { LiveDot } from "@/components/ui/Badge";
import { getStats } from "@/lib/api";
import type { PlatformStats } from "@/lib/types";
import { formatCount, formatDuration, formatXlm } from "@/lib/utils";

export function LivePulse() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getStats()
        .then((value) => {
          if (!cancelled) {
            setStats(value);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });

    load();
    const timer = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const items = [
    {
      icon: MessageSquare,
      label: "Answers delivered",
      value: formatCount(stats?.total_queries ?? 0),
      tone: "var(--accent)",
    },
    {
      icon: Coins,
      label: "Settled on Stellar",
      value: `${formatXlm(stats?.total_revenue_xlm ?? 0, 3)} XLM`,
      tone: "var(--value)",
    },
    {
      icon: Database,
      label: "Indexed passages",
      value: formatCount(stats?.indexed_vectors ?? 0),
      tone: "var(--data)",
    },
    {
      icon: Gauge,
      label: "Mean latency",
      value: stats?.avg_latency_ms ? formatDuration(stats.avg_latency_ms) : "—",
      tone: "var(--positive)",
    },
  ];

  return (
    <div className="mx-auto mt-14 max-w-3xl">
      <div className="panel edge-lit grid grid-cols-2 divide-[color:var(--line)] md:grid-cols-4 md:divide-x">
        {items.map(({ icon: Icon, label, value, tone }) => (
          <div key={label} className="px-4 py-5 text-center">
            <Icon size={15} className="mx-auto" style={{ color: tone }} />
            <p className="text-numeric mt-2.5 text-xl font-semibold tracking-tight text-[var(--text)]">
              {failed ? "—" : value}
            </p>
            <p className="mt-1 text-[0.6875rem] text-[var(--text-muted)]">{label}</p>
          </div>
        ))}
      </div>

      <p className="mt-3 flex items-center justify-center gap-2 text-[0.6875rem] text-[var(--text-faint)]">
        <LiveDot tone={failed ? "danger" : "positive"} />
        {failed
          ? "API unreachable — start the backend to see live numbers"
          : `Live from this deployment · ${stats?.model ?? "Gemini"} on ${stats?.network ?? "testnet"}`}
      </p>
    </div>
  );
}
