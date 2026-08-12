"use client";

/** One-click demo: a fleet of agents discovers the network and transacts.
 *
 * Each agent has a question from a different domain and no knowledge of who
 * can answer it. They run the full loop concurrently — discover, rank, pay,
 * invoke — and the panel shows the network forming underneath them: revenue
 * accruing, reputations moving, providers being chosen for the first time.
 *
 * Everything here is live traffic against the real API.
 */

import { useCallback, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Coins,
  Network,
  Play,
  Sparkles,
  Square,
  Timer,
  XCircle,
} from "lucide-react";

import { accentColor } from "@/components/marketplace/ProviderCard";
import { useSession } from "@/components/providers/SessionProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { Badge, LiveDot } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { routeRequest } from "@/lib/routeStream";
import { cn, formatDuration, formatXlm, truncate } from "@/lib/utils";

/** Each question belongs to a different provider's domain, so a correct
 *  network fans out across the whole marketplace rather than hammering one. */
const FLEET = [
  { role: "Legal researcher", question: "Can I exclude liability for death caused by negligence?" },
  { role: "Clinical analyst", question: "What is the number needed to treat, and why does it matter?" },
  { role: "Platform engineer", question: "How does Raft elect a leader after a partition?" },
  { role: "Compliance officer", question: "How long do I have to report a personal data breach?" },
  { role: "Equity analyst", question: "How do I calculate the weighted average cost of capital?" },
  { role: "Patent attorney", question: "Does a conference paper count as prior art?" },
  { role: "Curriculum lead", question: "Why does interleaving practice help long-term retention?" },
  { role: "ML engineer", question: "How do I detect concept drift in a deployed model?" },
];

type Phase =
  | "queued"
  | "discovering"
  | "ranking"
  | "paying"
  | "calling"
  | "done"
  | "failed";

interface FleetAgent {
  id: string;
  role: string;
  question: string;
  phase: Phase;
  provider?: string;
  accent?: string;
  considered?: number;
  shortlisted?: number;
  priceXlm?: number;
  confidence?: number;
  latencyMs?: number;
  totalMs?: number;
  grade?: string;
  chars: number;
  error?: string;
}

const PHASE_LABEL: Record<Phase, string> = {
  queued: "queued",
  discovering: "discovering",
  ranking: "ranking",
  paying: "settling",
  calling: "querying",
  done: "answered",
  failed: "failed",
};

const PROGRESS: Record<Phase, number> = {
  queued: 0,
  discovering: 18,
  ranking: 38,
  paying: 58,
  calling: 80,
  done: 100,
  failed: 100,
};

export function NetworkDemo({ onFinished }: { onFinished?: () => void }) {
  const { agentId, getToken, refresh } = useSession();
  const { toast } = useToast();

  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [size, setSize] = useState(4);

  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, changes: Partial<FleetAgent>) => {
    setAgents((current) =>
      current.map((agent) => (agent.id === id ? { ...agent, ...changes } : agent)),
    );
  }, []);

  const runAgent = useCallback(
    async (agent: FleetAgent, token: string, signal: AbortSignal) => {
      await routeRequest(
        { query: agent.question, agent_id: agentId!, objective: "balanced" },
        token,
        {
          onIntent: () => patch(agent.id, { phase: "discovering" }),
          onDiscovered: (p) =>
            patch(agent.id, { considered: p.considered, phase: "ranking" }),
          onRanked: (p) => patch(agent.id, { shortlisted: p.shortlisted }),
          onSelected: (p) =>
            patch(agent.id, {
              provider: p.provider.name,
              accent: p.provider.accent,
              priceXlm: p.provider.price_xlm,
              phase: "paying",
            }),
          onInvoking: () => patch(agent.id, { phase: "calling" }),
          onToken: (text) =>
            setAgents((current) =>
              current.map((item) =>
                item.id === agent.id
                  ? { ...item, chars: item.chars + text.length }
                  : item,
              ),
            ),
          onDone: (p) =>
            patch(agent.id, {
              phase: "done",
              confidence: p.confidence.percent,
              latencyMs: p.invocation_ms,
              totalMs: p.total_ms,
              grade: p.reputation_after.grade,
            }),
          onError: (error) =>
            patch(agent.id, { phase: "failed", error: error.message }),
        },
        signal,
      );
    },
    [agentId, patch],
  );

  const launch = useCallback(async () => {
    if (!agentId) return;

    const roster: FleetAgent[] = FLEET.slice(0, size).map((entry, index) => ({
      id: `fleet-${Date.now().toString(36)}-${index}`,
      role: entry.role,
      question: entry.question,
      phase: "queued",
      chars: 0,
    }));

    setAgents(roster);
    setRunning(true);
    setElapsed(0);

    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    const ticker = setInterval(() => setElapsed(performance.now() - startedAt), 100);

    try {
      const token = await getToken();
      await Promise.all(
        roster.map((agent) => runAgent(agent, token, controller.signal)),
      );
    } catch {
      toast({
        tone: "error",
        title: "Fleet could not launch",
        description: "Check that the API is reachable and the agent has credits.",
      });
    } finally {
      clearInterval(ticker);
      setElapsed(performance.now() - startedAt);
      setRunning(false);
      abortRef.current = null;
      void refresh();
      onFinished?.();
    }
  }, [agentId, getToken, onFinished, refresh, runAgent, size, toast]);

  const done = agents.filter((a) => a.phase === "done");
  const failed = agents.filter((a) => a.phase === "failed");
  const spend = done.reduce((sum, a) => sum + (a.priceXlm ?? 0), 0);
  const distinct = new Set(done.map((a) => a.provider)).size;
  const avgConfidence = done.length
    ? Math.round(done.reduce((sum, a) => sum + (a.confidence ?? 0), 0) / done.length)
    : 0;

  return (
    <section id="demo" className="mt-16 scroll-mt-24">
      <SectionHeader
        eyebrow="One click"
        title="Launch the economy"
        description="A fleet of agents, each with a question from a different field and no idea who can answer it. They discover the marketplace, evaluate it, pay, and consume — concurrently, against the live network."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[var(--surface-raised)] p-0.5">
              {[2, 4, 8].map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={running}
                  onClick={() => setSize(option)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                    size === option
                      ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text)]",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            {running ? (
              <Button
                onClick={() => abortRef.current?.abort()}
                icon={<Square size={13} />}
              >
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={() => void launch()}
                icon={<Play size={15} />}
              >
                Launch the network
              </Button>
            )}
          </div>
        }
      />

      {agents.length > 0 ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            icon={<Bot size={13} />}
            label="Agents served"
            value={`${done.length}/${agents.length}`}
            tone="var(--accent)"
          />
          <Metric
            icon={<Network size={13} />}
            label="Providers engaged"
            value={String(distinct)}
            tone="var(--data)"
          />
          <Metric
            icon={<Coins size={13} />}
            label="Network revenue"
            value={`${formatXlm(spend, 4)} XLM`}
            tone="var(--value)"
          />
          <Metric
            icon={<Timer size={13} />}
            label="Wall clock"
            value={formatDuration(elapsed)}
            tone="var(--positive)"
          />
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {agents.length === 0 ? (
          <Card className="py-12 text-center">
            <Sparkles size={24} className="mx-auto text-[var(--accent-strong)]" />
            <p className="mt-3 text-sm font-medium text-[var(--text)]">
              Nothing here is wired to an endpoint
            </p>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-[var(--text-muted)]">
              Press launch and watch a legal question find the legal provider, a
              clinical question find the clinical one, and each agent settle
              independently at whatever that provider charges.
            </p>
          </Card>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              className={cn(
                "relative overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)] px-4 py-3 transition-colors",
                agent.phase === "done"
                  ? "border-[color:var(--positive)]/25"
                  : agent.phase === "failed"
                    ? "border-[color:var(--danger)]/30"
                    : "border-[color:var(--line)]",
              )}
            >
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 opacity-[0.10] transition-all duration-500"
                style={{
                  width: `${PROGRESS[agent.phase]}%`,
                  background:
                    agent.phase === "failed"
                      ? "var(--danger)"
                      : agent.accent
                        ? accentColor(agent.accent)
                        : "var(--accent)",
                }}
              />

              <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="shrink-0">
                  {agent.phase === "done" ? (
                    <CheckCircle2 size={15} className="text-[var(--positive)]" />
                  ) : agent.phase === "failed" ? (
                    <XCircle size={15} className="text-[var(--danger)]" />
                  ) : agent.phase === "queued" ? (
                    <span className="block h-[15px] w-[15px] rounded-full border border-[color:var(--line-strong)]" />
                  ) : (
                    <LiveDot tone="accent" />
                  )}
                </span>

                <span className="w-32 shrink-0 truncate text-xs font-medium text-[var(--text)]">
                  {agent.role}
                </span>

                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-muted)]">
                  {agent.error ?? truncate(agent.question, 62)}
                </span>

                {agent.provider ? (
                  <span
                    className="flex shrink-0 items-center gap-1.5 text-xs font-medium"
                    style={{ color: accentColor(agent.accent ?? "accent") }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {agent.provider}
                  </span>
                ) : agent.considered ? (
                  <span className="mono shrink-0 text-[0.625rem] text-[var(--text-faint)]">
                    {agent.shortlisted ?? "—"}/{agent.considered} eligible
                  </span>
                ) : null}

                <span className="mono w-20 shrink-0 text-right text-[0.625rem] text-[var(--text-faint)]">
                  {PHASE_LABEL[agent.phase]}
                </span>

                <span className="mono w-16 shrink-0 text-right text-[0.625rem]">
                  {agent.phase === "calling" ? (
                    <span className="text-[var(--accent-strong)]">
                      {agent.chars} ch
                    </span>
                  ) : agent.totalMs ? (
                    <span className="text-[var(--text-muted)]">
                      {formatDuration(agent.totalMs)}
                    </span>
                  ) : null}
                </span>

                <span className="mono w-14 shrink-0 text-right text-[0.625rem] text-[var(--value)]">
                  {agent.priceXlm ? `${formatXlm(agent.priceXlm, 3)}` : ""}
                </span>

                <span className="mono w-10 shrink-0 text-right text-[0.625rem] text-[var(--positive)]">
                  {agent.confidence ? `${agent.confidence}%` : ""}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {done.length > 0 && !running ? (
        <div className="animate-rise mt-4 rounded-[var(--radius)] border border-[color:var(--line-accent)] bg-[var(--accent-soft)] px-4 py-3.5">
          <p className="flex items-start gap-2.5 text-sm text-[var(--text)]">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--accent-strong)]" />
            <span>
              <strong>{done.length} agents</strong> discovered the network, evaluated{" "}
              {agents[0]?.considered ?? 0} providers each, selected{" "}
              <strong>{distinct} different services</strong>, settled{" "}
              <strong>{formatXlm(spend, 4)} XLM</strong> in micropayments, and
              received answers averaging <strong>{avgConfidence}% confidence</strong> —
              in {formatDuration(elapsed)}. No endpoint was configured in advance, and
              no human was in the loop for any of these transactions.
            </span>
          </p>
        </div>
      ) : null}

      {failed.length > 0 && !running ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Badge tone="danger">{failed.length} failed</Badge>
          Failed calls are refunded automatically and recorded against the
          provider&rsquo;s reliability.
        </p>
      ) : null}
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="panel p-3">
      <p
        className="flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.06em]"
        style={{ color: tone }}
      >
        {icon}
        {label}
      </p>
      <p className="text-numeric mt-1.5 text-xl font-semibold leading-none text-[var(--text)]">
        {value}
      </p>
    </div>
  );
}
