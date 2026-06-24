"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity, CreditCard, Database, FileText,
  RefreshCw, Bot, Zap, TrendingUp, Globe,
  CheckCircle, AlertCircle,
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  getGlobalStats, getHealth,
  type GlobalStats,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BackendStatus {
  online: boolean;
  version?: string;
}

// ── Mock transaction log (live data requires a database) ──────────────────────

const MOCK_TRANSACTIONS = [
  { id: "agent_4f2a91", query: "Explain quantum computing basics", xlm: 0.01, status: "success", ts: "2s ago"  },
  { id: "agent_b83c12", query: "What is LangChain RetrievalQA?",  xlm: 0.01, status: "success", ts: "18s ago" },
  { id: "agent_291de4", query: "How does Stellar consensus work?", xlm: 0.01, status: "success", ts: "1m ago"  },
  { id: "agent_77fa03", query: "Describe transformer attention",   xlm: 0.01, status: "pending", ts: "2m ago"  },
  { id: "agent_cc12ab", query: "RAG vs fine-tuning trade-offs",    xlm: 0.01, status: "success", ts: "5m ago"  },
  { id: "agent_9de3f1", query: "Stellar Horizon API reference",    xlm: 0.01, status: "success", ts: "8m ago"  },
];

// ── Animated counter ──────────────────────────────────────────────────────────

function useCounter(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    const step = target / (duration / 16);
    let cur = 0;
    const t = setInterval(() => {
      cur = Math.min(cur + step, target);
      setValue(Math.floor(cur));
      if (cur >= target) clearInterval(t);
    }, 16);
    return () => clearInterval(t);
  }, [target, duration]);
  return value;
}

// ── Stat cards using live data ────────────────────────────────────────────────

function StatsGrid({ stats }: { stats: GlobalStats | null }) {
  const queries   = useCounter(stats?.total_queries   ?? 0);
  const payments  = useCounter(stats?.total_payments  ?? 0);
  const docs      = useCounter(stats?.total_documents ?? 0);
  const revenue   = stats?.revenue_xlm ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      <StatCard
        label="Total API Requests"
        value={queries.toLocaleString()}
        delta="Live from backend"
        deltaPositive
        icon={<Activity size={22} />}
        accent="violet"
      />
      <StatCard
        label="Total Payments"
        value={payments.toLocaleString()}
        delta="Stellar transactions"
        deltaPositive
        icon={<CreditCard size={22} />}
        accent="blue"
      />
      <StatCard
        label="Revenue Generated"
        value={`${revenue.toFixed(4)} XLM`}
        delta={`≈ $${(revenue * 0.10).toFixed(4)} USD`}
        deltaPositive
        icon={<TrendingUp size={22} />}
        accent="cyan"
      />
      <StatCard
        label="Uploaded Documents"
        value={docs.toLocaleString()}
        delta="ChromaDB chunks"
        deltaPositive
        icon={<Database size={22} />}
        accent="amber"
      />
    </div>
  );
}

// ── System status panel ───────────────────────────────────────────────────────

function SystemStatus({
  backendStatus,
  stats,
}: {
  backendStatus: BackendStatus;
  stats: GlobalStats | null;
}) {
  const items = [
    {
      label: "FastAPI Backend",
      status: backendStatus.online ? "online" : "offline",
      detail: backendStatus.online ? `v${backendStatus.version ?? "1.0.0"}` : "Unreachable",
      icon: <Globe size={16} />,
    },
    {
      label: "Gemini RAG Model",
      status: stats ? "online" : "unknown",
      detail: stats?.model ?? "gemini-2.0-flash",
      icon: <Bot size={16} />,
    },
    {
      label: "Stellar Network",
      status: "online",
      detail: stats?.network ?? "testnet",
      icon: <CreditCard size={16} />,
    },
    {
      label: "ChromaDB Vector Store",
      status: stats ? "online" : "unknown",
      detail: `${stats?.total_documents ?? 0} docs indexed`,
      icon: <Database size={16} />,
    },
  ];

  return (
    <div className="glass-card rounded-2xl p-6">
      <h3 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
        <Zap size={18} className="text-violet-400" />
        System Status
      </h3>
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-slate-500">{item.icon}</span>
              <span className="text-sm text-slate-300">{item.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{item.detail}</span>
              {item.status === "online" ? (
                <CheckCircle size={14} className="text-emerald-400" />
              ) : item.status === "offline" ? (
                <AlertCircle size={14} className="text-red-400" />
              ) : (
                <span className="w-3.5 h-3.5 rounded-full bg-amber-400/40 border border-amber-400/60" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Transaction log ───────────────────────────────────────────────────────────

function TransactionLog() {
  return (
    <div className="glass-card rounded-2xl p-6">
      <h3 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
        <Activity size={18} className="text-blue-400" />
        Recent Agent Queries
        <Badge variant="blue" className="ml-auto text-xs py-0.5">Live</Badge>
      </h3>
      <div className="space-y-3">
        {MOCK_TRANSACTIONS.map((tx) => (
          <div
            key={tx.id + tx.ts}
            className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors"
          >
            <div
              className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                tx.status === "success" ? "bg-emerald-400" :
                tx.status === "pending" ? "bg-amber-400" : "bg-red-400"
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-200 truncate">{tx.query}</p>
              <p className="text-xs text-slate-600 mt-0.5 font-mono">{tx.id}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs font-mono text-emerald-400">{tx.xlm} XLM</p>
              <p className="text-xs text-slate-600">{tx.ts}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Revenue sparkline (pure CSS visual) ──────────────────────────────────────

const SPARKLINE = [20, 35, 28, 50, 42, 60, 55, 72, 68, 85, 78, 100];

function RevenueChart({ revenueXlm }: { revenueXlm: number }) {
  const max = Math.max(...SPARKLINE);
  return (
    <div className="glass-card rounded-2xl p-6">
      <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
        <TrendingUp size={18} className="text-cyan-400" />
        Revenue Trend
      </h3>
      <p className="text-slate-500 text-sm mb-5">XLM earned per session</p>
      <div className="flex items-end gap-1.5 h-24">
        {SPARKLINE.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm transition-all duration-700"
            style={{
              height: `${(v / max) * 100}%`,
              background: `hsl(${250 + i * 4}, 70%, ${50 + (v / max) * 20}%)`,
              opacity: 0.7 + (i / SPARKLINE.length) * 0.3,
            }}
          />
        ))}
      </div>
      <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
        <span className="text-sm text-slate-400">Total revenue</span>
        <span className="font-mono text-cyan-400 font-bold">
          {revenueXlm.toFixed(4)} XLM
        </span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ online: false });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.allSettled([getGlobalStats(), getHealth()]);
      if (s.status === "fulfilled") setStats(s.value);
      if (h.status === "fulfilled") {
        setBackendStatus({ online: true, version: h.value.version });
      } else {
        setBackendStatus({ online: false });
      }
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 15_000); // auto-refresh every 15s
    return () => clearInterval(t);
  }, [fetchData]);

  return (
    <>
      <Navbar />
      <main className="flex-1 pt-24 pb-16 px-6">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10">
            <div>
              <Badge variant="violet" className="mb-3">
                <span className="pulse-dot violet" />
                Live Dashboard
              </Badge>
              <h1 className="section-heading">
                Platform <span className="gradient-text">Analytics</span>
              </h1>
              <p className="text-slate-400 mt-2 text-sm">
                Real-time data from backend · auto-refreshes every 15s
              </p>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="btn-secondary flex items-center gap-2 self-start"
              id="dashboard-refresh-btn"
            >
              <RefreshCw
                size={15}
                className={loading ? "animate-spin" : ""}
              />
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {/* Backend offline warning */}
          {!backendStatus.online && !loading && (
            <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center gap-3">
              <AlertCircle size={18} className="text-amber-400 flex-shrink-0" />
              <p className="text-sm text-amber-200">
                Backend is offline. Start FastAPI with{" "}
                <code className="code-badge">uvicorn app.main:app --reload</code> in the{" "}
                <code className="code-badge">backend/</code> directory. Stats shown are empty.
              </p>
            </div>
          )}

          {/* Stat cards */}
          <StatsGrid stats={stats} />

          {/* Main grid */}
          <div className="grid lg:grid-cols-3 gap-6 mt-6">
            {/* Transaction log — 2 cols */}
            <div className="lg:col-span-2">
              <TransactionLog />
            </div>

            {/* Right column */}
            <div className="space-y-6">
              <SystemStatus backendStatus={backendStatus} stats={stats} />
              <RevenueChart revenueXlm={stats?.revenue_xlm ?? 0} />
            </div>
          </div>

          {/* Meta */}
          <p className="text-center text-xs text-slate-700 mt-8">
            Last refreshed: {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
