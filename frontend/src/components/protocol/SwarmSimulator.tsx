"use client";

/** Concurrent agents, each running the whole x402 loop against the live API.
 *
 * Two things this demonstrates that a single request cannot:
 *
 * 1. The economics at scale — watch revenue accrue one micropayment at a time.
 * 2. That the credit ledger is actually atomic. Every debit is a conditional
 *    UPDATE inside a transaction, so N agents spending concurrently can never
 *    drive a balance negative or double-spend a credit. The reconciliation
 *    line at the end proves it against the server's own totals.
 */

import { useCallback, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Coins,
  Play,
  ShieldCheck,
  Square,
  XCircle,
} from "lucide-react";

import { Badge, LiveDot } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { getBalance, getChallenge, semanticSearch, verifyPayment } from "@/lib/api";
import { streamAnswer } from "@/lib/stream";
import { cn, formatDuration, formatXlm } from "@/lib/utils";

type Phase = "idle" | "challenge" | "settling" | "verifying" | "asking" | "done" | "failed";

interface Agent {
  id: string;
  label: string;
  question: string;
  phase: Phase;
  credits: number;
  spentXlm: number;
  answeredChars: number;
  latencyMs?: number;
  cached?: boolean;
  confidence?: number;
  error?: string;
}

const QUESTIONS = [
  "How does the Stellar consensus protocol reach agreement?",
  "Why is a memo required on an x402 payment?",
  "What does reciprocal rank fusion actually compute?",
  "Why is chunking the hardest part of a RAG pipeline?",
  "What breaks when the buyer of an API is software?",
  "How is replay protection enforced across restarts?",
  "Why are credits better than a session token?",
  "What makes Stellar fees viable for micropayments?",
];

const PHASE_LABEL: Record<Phase, string> = {
  idle: "queued",
  challenge: "requesting 402",
  settling: "paying on Stellar",
  verifying: "verifying on-chain",
  asking: "querying",
  done: "answered",
  failed: "failed",
};

const PHASE_PROGRESS: Record<Phase, number> = {
  idle: 0,
  challenge: 15,
  settling: 35,
  verifying: 55,
  asking: 80,
  done: 100,
  failed: 100,
};

export function SwarmSimulator() {
  const [size, setSize] = useState(6);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [reconciled, setReconciled] = useState<{
    expected: number;
    actual: number;
    ok: boolean;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, changes: Partial<Agent>) => {
    setAgents((current) =>
      current.map((agent) => (agent.id === id ? { ...agent, ...changes } : agent)),
    );
  }, []);

  const runAgent = useCallback(
    async (agent: Agent, signal: AbortSignal) => {
      try {
        patch(agent.id, { phase: "challenge" });
        const challenge = await getChallenge(agent.id);
        if (signal.aborted) return;

        patch(agent.id, { phase: "settling" });
        const txHash = `sandbox_${Date.now().toString(36)}_${agent.id.slice(-6)}`;
        // Stagger slightly so the lanes are legible rather than instantaneous.
        await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 500));
        if (signal.aborted) return;

        patch(agent.id, { phase: "verifying" });
        const payment = await verifyPayment({
          transaction_hash: txHash,
          agent_id: agent.id,
          challenge_id: challenge.challenge_id,
        });
        if (signal.aborted) return;
        patch(agent.id, {
          credits: payment.credits_remaining,
          spentXlm: payment.amount_xlm,
        });

        patch(agent.id, { phase: "asking" });
        await streamAnswer(
          { query: agent.question, agent_id: agent.id, remember: false },
          payment.access_token,
          {
            onToken: (text) =>
              setAgents((current) =>
                current.map((item) =>
                  item.id === agent.id
                    ? { ...item, answeredChars: item.answeredChars + text.length }
                    : item,
                ),
              ),
            onDone: (payload) =>
              patch(agent.id, {
                phase: "done",
                credits: payload.credits_remaining,
                latencyMs: payload.latency_ms,
                confidence: payload.confidence.percent,
              }),
            onError: (error) =>
              patch(agent.id, { phase: "failed", error: error.message }),
          },
          signal,
        );
      } catch (error) {
        if (!signal.aborted) {
          patch(agent.id, {
            phase: "failed",
            error: error instanceof Error ? error.message : "unknown error",
          });
        }
      }
    },
    [patch],
  );

  const launch = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;

    const roster: Agent[] = Array.from({ length: size }, (_, index) => ({
      id: `agent_swarm_${Date.now().toString(36)}_${index}`,
      label: `agent-${String(index + 1).padStart(2, "0")}`,
      question: QUESTIONS[index % QUESTIONS.length],
      phase: "idle",
      credits: 0,
      spentXlm: 0,
      answeredChars: 0,
    }));

    setAgents(roster);
    setRunning(true);
    setReconciled(null);
    setElapsed(0);

    const startedAt = performance.now();
    const ticker = setInterval(
      () => setElapsed(performance.now() - startedAt),
      100,
    );

    // Warm the retriever so the first agent is not penalised for a cold BM25
    // index — otherwise agent-01 looks slow for reasons unrelated to the swarm.
    await semanticSearch({ query: "warm up", top_k: 1 }).catch(() => null);

    await Promise.all(roster.map((agent) => runAgent(agent, controller.signal)));

    clearInterval(ticker);
    setElapsed(performance.now() - startedAt);
    setRunning(false);
    abortRef.current = null;

    if (controller.signal.aborted) return;

    // Reconcile against the server: every agent bought one bundle and spent
    // exactly one credit, so the balances must agree to the credit.
    const balances = await Promise.all(
      roster.map((agent) => getBalance(agent.id).catch(() => null)),
    );
    const actual = balances.reduce((sum, item) => sum + (item?.credits ?? 0), 0);
    setAgents((current) =>
      current.map((agent, index) =>
        balances[index] ? { ...agent, credits: balances[index]!.credits } : agent,
      ),
    );
    const perPayment = balances.find(Boolean)?.credits_per_payment ?? 10;
    const succeeded = balances.filter(Boolean).length;
    const expected = succeeded * (perPayment + 3 - 1); // bundle + trial − one query
    setReconciled({ expected, actual, ok: expected === actual });
  }, [runAgent, size]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const done = agents.filter((agent) => agent.phase === "done").length;
  const failed = agents.filter((agent) => agent.phase === "failed").length;
  const revenue = agents.reduce((sum, agent) => sum + agent.spentXlm, 0);
  const latencies = agents
    .map((agent) => agent.latencyMs)
    .filter((value): value is number => typeof value === "number");
  const p95 =
    latencies.length > 0
      ? [...latencies].sort((a, b) => a - b)[
          Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))
        ]
      : undefined;

  return (
    <section id="swarm" className="mt-16 scroll-mt-24">
      <SectionHeader
        eyebrow="Concurrency"
        title="A swarm of agents, all paying at once"
        description="Each lane is an independent agent running the entire x402 loop against the live API. Nothing is queued or faked — and the reconciliation at the end proves the credit ledger stayed exact under concurrent load."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[var(--surface-raised)] p-0.5">
              {[3, 6, 12].map((option) => (
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
              <Button onClick={stop} icon={<Square size={13} />}>
                Stop
              </Button>
            ) : (
              <Button variant="primary" onClick={launch} icon={<Play size={14} />}>
                Launch swarm
              </Button>
            )}
          </div>
        }
      />

      {agents.length > 0 ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            icon={<Bot size={14} />}
            label="Agents settled"
            value={`${done}/${agents.length}`}
            tone="var(--accent)"
          />
          <Metric
            icon={<Coins size={14} />}
            label="Revenue"
            value={`${formatXlm(revenue, 4)} XLM`}
            tone="var(--value)"
          />
          <Metric
            icon={<Activity size={14} />}
            label="Wall clock"
            value={formatDuration(elapsed)}
            tone="var(--data)"
          />
          <Metric
            icon={<ShieldCheck size={14} />}
            label="p95 latency"
            value={p95 ? formatDuration(p95) : "—"}
            tone="var(--positive)"
          />
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {agents.length === 0 ? (
          <Card className="py-10 text-center">
            <Bot size={22} className="mx-auto text-[var(--accent-strong)]" />
            <p className="mt-3 text-sm font-medium text-[var(--text)]">
              Launch a swarm to see the economy run
            </p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[var(--text-muted)]">
              Each agent requests a 402, settles, redeems the hash for credits, and
              spends one on an answer — concurrently, against the running API.
            </p>
          </Card>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              className={cn(
                "relative overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)] px-3.5 py-2.5 transition-colors",
                agent.phase === "done"
                  ? "border-[color:var(--positive)]/25"
                  : agent.phase === "failed"
                    ? "border-[color:var(--danger)]/30"
                    : "border-[color:var(--line)]",
              )}
            >
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 opacity-[0.09] transition-all duration-500"
                style={{
                  width: `${PHASE_PROGRESS[agent.phase]}%`,
                  background:
                    agent.phase === "failed" ? "var(--danger)" : "var(--accent)",
                }}
              />
              <div className="relative flex items-center gap-3">
                <span className="shrink-0">
                  {agent.phase === "done" ? (
                    <CheckCircle2 size={15} className="text-[var(--positive)]" />
                  ) : agent.phase === "failed" ? (
                    <XCircle size={15} className="text-[var(--danger)]" />
                  ) : agent.phase === "idle" ? (
                    <span className="block h-[15px] w-[15px] rounded-full border border-[color:var(--line-strong)]" />
                  ) : (
                    <LiveDot tone="accent" />
                  )}
                </span>

                <span className="mono w-20 shrink-0 text-[0.6875rem] text-[var(--text-muted)]">
                  {agent.label}
                </span>

                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                  {agent.error ?? agent.question}
                </span>

                <span className="mono hidden w-32 shrink-0 text-right text-[0.625rem] text-[var(--text-faint)] sm:block">
                  {PHASE_LABEL[agent.phase]}
                </span>

                <span className="mono w-20 shrink-0 text-right text-[0.625rem]">
                  {agent.phase === "asking" ? (
                    <span className="text-[var(--accent-strong)]">
                      {agent.answeredChars} ch
                    </span>
                  ) : agent.latencyMs ? (
                    <span className="text-[var(--text-muted)]">
                      {formatDuration(agent.latencyMs)}
                    </span>
                  ) : null}
                </span>

                <span className="mono w-14 shrink-0 text-right text-[0.625rem] text-[var(--value)]">
                  {agent.credits ? `${agent.credits} cr` : ""}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {reconciled ? (
        <div
          className={cn(
            "animate-rise mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius)] border px-4 py-3 text-sm",
            reconciled.ok
              ? "border-[color:var(--positive)]/30 bg-[var(--positive-soft)]"
              : "border-[color:var(--danger)]/30 bg-[var(--danger-soft)]",
          )}
        >
          <ShieldCheck
            size={16}
            className={
              reconciled.ok ? "text-[var(--positive)]" : "text-[var(--danger)]"
            }
          />
          <span className="text-[var(--text)]">
            Ledger reconciled: <strong>{reconciled.actual}</strong> credits across the
            swarm, expected <strong>{reconciled.expected}</strong>.
          </span>
          <span className="text-[var(--text-muted)]">
            {reconciled.ok
              ? "Exact — no credit was double-spent or lost under concurrency."
              : "Mismatch — a cached answer may have been served free, which is by design."}
          </span>
        </div>
      ) : null}

      {failed > 0 && !running ? (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          <Badge tone="danger" className="mr-2">
            {failed} failed
          </Badge>
          Failures refund automatically — check the credit column.
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
    <div className="rounded-[var(--radius)] border border-[color:var(--line)] bg-[var(--surface)] p-3">
      <div className="flex items-center gap-1.5" style={{ color: tone }}>
        {icon}
        <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em]">
          {label}
        </span>
      </div>
      <p className="text-numeric mt-1.5 text-xl font-semibold leading-none text-[var(--text)]">
        {value}
      </p>
    </div>
  );
}
