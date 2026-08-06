"use client";

/**
 * The demo director.
 *
 * Reliability is the whole design. A live demo fails when the presentation
 * waits on the network, so here **the timeline never awaits anything**. Phases
 * advance on wall-clock timers; real API work is kicked off inside a phase and
 * allowed to land whenever it lands. If a call is slow, the story keeps moving
 * and the result appears late. If a call fails, that agent is marked and the
 * remaining three carry the narrative.
 *
 * Everything shown is real: real discovery against the live registry, real
 * x402 settlement, real streamed answers, real reputation movement.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { useSession } from "@/components/providers/SessionProvider";
import * as api from "@/lib/api";
import { routeRequest } from "@/lib/routeStream";

export type PhaseId =
  | "boot"
  | "agents"
  | "discovery"
  | "ranking"
  | "payment"
  | "retrieval"
  | "answers"
  | "economy"
  | "summary";

interface Phase {
  id: PhaseId;
  label: string;
  caption: string;
  ms: number;
  route?: string;
}

/** The cinematic. Durations are the contract; work fits around them. */
const PHASES: Phase[] = [
  {
    id: "boot",
    label: "Booting the agent network",
    caption: "Connecting to the registry and funding the agent wallet",
    ms: 2200,
    route: "/discover",
  },
  {
    id: "agents",
    label: "Dispatching autonomous agents",
    caption: "Four agents, four fields, no configured endpoints",
    ms: 2800,
  },
  {
    id: "discovery",
    label: "Discovering the marketplace",
    caption: "Reading capabilities, prices, latency and reputation",
    ms: 3200,
    route: "/marketplace",
  },
  {
    id: "ranking",
    label: "Evaluating every provider",
    caption: "Capability sets the ceiling; price and speed compete within it",
    ms: 4000,
    route: "/discover",
  },
  {
    id: "payment",
    label: "Settling micropayments",
    caption: "x402 on Stellar — each agent pays its chosen provider",
    ms: 3400,
  },
  {
    id: "retrieval",
    label: "Retrieving knowledge",
    caption: "Queries landing among the passages that answer them",
    ms: 4800,
    route: "/atlas",
  },
  {
    id: "answers",
    label: "Answers streaming back",
    caption: "Grounded, cited, and scored for confidence",
    ms: 5000,
    route: "/discover",
  },
  {
    id: "economy",
    label: "The economy updates",
    caption: "Revenue booked, reputations moved, ledger reconciled",
    ms: 4500,
    route: "/dashboard",
  },
  { id: "summary", label: "Transaction complete", caption: "", ms: 0 },
];

const TOTAL_MS = PHASES.reduce((sum, phase) => sum + phase.ms, 0);

/** One task per field, so a correct network fans out across the marketplace. */
const CAST = [
  {
    role: "Legal researcher",
    task: "Can I exclude liability for death caused by negligence?",
  },
  {
    role: "Clinical analyst",
    task: "What is the number needed to treat, and why does it matter?",
  },
  {
    role: "Platform engineer",
    task: "How does Raft elect a leader after a partition?",
  },
  {
    role: "Compliance officer",
    task: "How long do I have to report a personal data breach?",
  },
] as const;

export type AgentStatus =
  | "idle"
  | "dispatched"
  | "evaluating"
  | "selected"
  | "paid"
  | "answering"
  | "done"
  | "failed";

export interface DemoAgent {
  id: string;
  role: string;
  task: string;
  status: AgentStatus;
  evaluations: number;
  eligible?: number;
  provider?: string;
  accent?: string;
  priceXlm?: number;
  credits?: number;
  confidence?: number;
  chars: number;
  latencyMs?: number;
  error?: string;
}

export interface DemoMetrics {
  agents: number;
  evaluations: number;
  payments: number;
  revenueXlm: number;
  transactions: number;
  providersOnline: number;
  avgConfidence: number;
}

interface DemoValue {
  active: boolean;
  phase: Phase;
  phaseIndex: number;
  phases: Phase[];
  progress: number;
  elapsedMs: number;
  totalMs: number;
  agents: DemoAgent[];
  metrics: DemoMetrics;
  atlasQuery: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

const DemoContext = createContext<DemoValue | null>(null);

const EMPTY_METRICS: DemoMetrics = {
  agents: 0,
  evaluations: 0,
  payments: 0,
  revenueXlm: 0,
  transactions: 0,
  providersOnline: 0,
  avgConfidence: 0,
};

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { agentId, credits, getToken, purchaseCredits, refresh, setCredits } =
    useSession();

  const [active, setActive] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [agents, setAgents] = useState<DemoAgent[]>([]);
  const [metrics, setMetrics] = useState<DemoMetrics>(EMPTY_METRICS);
  const [atlasQuery, setAtlasQuery] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef(0);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  const patch = useCallback((id: string, changes: Partial<DemoAgent>) => {
    setAgents((current) =>
      current.map((agent) => (agent.id === id ? { ...agent, ...changes } : agent)),
    );
  }, []);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearTimers();
    setActive(false);
    setPhaseIndex(0);
    setElapsedMs(0);
    setAtlasQuery(null);
    void refresh();
  }, [clearTimers, refresh]);

  // ── Background work, none of which the timeline waits on ──────────────────

  const warmUp = useCallback(
    async (runId: number) => {
      try {
        const [stats] = await Promise.all([
          api.getNetworkStats().catch(() => null),
          api.listProviders().catch(() => null),
        ]);
        if (runId !== runIdRef.current) return;
        if (stats) {
          setMetrics((current) => ({
            ...current,
            providersOnline: stats.providers_online,
          }));
        }
      } catch {
        /* the demo continues without warm stats */
      }

      // Four routed calls cost up to ~11 credits. Top up so the demo cannot
      // stall on an empty balance halfway through.
      try {
        if (credits < 24) {
          const result = await purchaseCredits({ mode: "sandbox" });
          if (runId === runIdRef.current) setCredits(result.credits_remaining);
        }
      } catch {
        /* if settlement fails the routes will simply report insufficient credit */
      }
    },
    [credits, purchaseCredits, setCredits],
  );

  /** Free ranking pass — gives real evaluation counts before anyone pays. */
  const evaluate = useCallback(
    async (runId: number, roster: DemoAgent[]) => {
      await Promise.all(
        roster.map(async (agent) => {
          try {
            const decision = await api.discoverProviders(agent.task, "balanced");
            if (runId !== runIdRef.current) return;
            patch(agent.id, {
              status: "selected",
              evaluations: decision.considered,
              eligible: decision.shortlisted,
              provider: decision.chosen?.name,
              accent: decision.chosen?.accent,
              priceXlm: decision.chosen?.price_xlm,
              credits: decision.chosen?.credits_per_call,
            });
            setMetrics((current) => ({
              ...current,
              evaluations: current.evaluations + decision.considered,
            }));
          } catch {
            if (runId === runIdRef.current) {
              patch(agent.id, { status: "evaluating" });
            }
          }
        }),
      );
    },
    [patch],
  );

  /** The paid loop: settle, invoke, stream, record. */
  const transact = useCallback(
    async (runId: number, roster: DemoAgent[], signal: AbortSignal) => {
      if (!agentId) return;
      let token: string;
      try {
        token = await getToken();
      } catch {
        roster.forEach((agent) =>
          patch(agent.id, { status: "failed", error: "no access token" }),
        );
        return;
      }

      await Promise.all(
        roster.map((agent) =>
          routeRequest(
            { query: agent.task, agent_id: agentId, objective: "balanced" },
            token,
            {
              onSelected: (payload) =>
                runId === runIdRef.current &&
                patch(agent.id, {
                  status: "selected",
                  provider: payload.provider.name,
                  accent: payload.provider.accent,
                  priceXlm: payload.provider.price_xlm,
                  credits: payload.provider.credits_per_call,
                }),
              onPayment: (payload) => {
                if (runId !== runIdRef.current || payload.stage !== "settled") return;
                patch(agent.id, { status: "paid" });
                setCredits(payload.credits_remaining ?? 0);
                setMetrics((current) => ({
                  ...current,
                  payments: current.payments + 1,
                  revenueXlm: current.revenueXlm + payload.price_xlm,
                }));
              },
              onInvoking: () =>
                runId === runIdRef.current && patch(agent.id, { status: "answering" }),
              onToken: (text) => {
                if (runId !== runIdRef.current) return;
                setAgents((current) =>
                  current.map((item) =>
                    item.id === agent.id
                      ? { ...item, chars: item.chars + text.length }
                      : item,
                  ),
                );
              },
              onDone: (payload) => {
                if (runId !== runIdRef.current) return;
                patch(agent.id, {
                  status: "done",
                  confidence: payload.confidence.percent,
                  latencyMs: payload.total_ms,
                });
                setCredits(payload.credits_remaining);
                setMetrics((current) => {
                  const transactions = current.transactions + 1;
                  return {
                    ...current,
                    transactions,
                    avgConfidence:
                      (current.avgConfidence * current.transactions +
                        payload.confidence.percent) /
                      transactions,
                  };
                });
              },
              onError: (error) =>
                runId === runIdRef.current &&
                patch(agent.id, { status: "failed", error: error.message }),
            },
            signal,
          ).catch(() => {
            if (runId === runIdRef.current) {
              patch(agent.id, { status: "failed", error: "provider unreachable" });
            }
          }),
        ),
      );
    },
    [agentId, getToken, patch, setCredits],
  );

  // ── The director ──────────────────────────────────────────────────────────

  const start = useCallback(() => {
    if (active || !agentId) return;

    runIdRef.current += 1;
    const runId = runIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    const roster: DemoAgent[] = CAST.map((entry, index) => ({
      id: `demo-${runId}-${index}`,
      role: entry.role,
      task: entry.task,
      status: "idle",
      evaluations: 0,
      chars: 0,
    }));

    clearTimers();
    setActive(true);
    setPhaseIndex(0);
    setElapsedMs(0);
    setAgents(roster);
    setMetrics({ ...EMPTY_METRICS, agents: roster.length });
    setAtlasQuery(null);

    const startedAt = performance.now();
    tickerRef.current = setInterval(() => {
      if (runId !== runIdRef.current) return;
      setElapsedMs(Math.min(TOTAL_MS, performance.now() - startedAt));
    }, 80);

    // Schedule every phase up front. Nothing here can be delayed by the network.
    let offset = 0;
    PHASES.forEach((phase, index) => {
      const at = offset;
      offset += phase.ms;

      timersRef.current.push(
        setTimeout(() => {
          if (runId !== runIdRef.current) return;
          setPhaseIndex(index);
          if (phase.route) router.push(phase.route);

          switch (phase.id) {
            case "boot":
              void warmUp(runId);
              break;
            case "agents":
              roster.forEach((agent, position) =>
                timersRef.current.push(
                  setTimeout(() => {
                    if (runId === runIdRef.current) {
                      patch(agent.id, { status: "dispatched" });
                    }
                  }, position * 320),
                ),
              );
              break;
            case "ranking":
              setAgents((current) =>
                current.map((agent) => ({ ...agent, status: "evaluating" })),
              );
              void evaluate(runId, roster);
              break;
            case "payment":
              void transact(runId, roster, controller.signal);
              break;
            case "retrieval":
              setAtlasQuery(CAST[1].task);
              break;
            case "economy":
              void refresh();
              break;
            default:
              break;
          }
        }, at),
      );
    });

    // Hold on the summary, then hand control back cleanly.
    timersRef.current.push(
      setTimeout(() => {
        if (runId !== runIdRef.current) return;
        setElapsedMs(TOTAL_MS);
        void refresh();
      }, offset),
    );
  }, [
    active,
    agentId,
    clearTimers,
    evaluate,
    patch,
    refresh,
    router,
    transact,
    warmUp,
  ]);

  const toggle = useCallback(() => (active ? stop() : start()), [active, start, stop]);

  // ── Shortcuts ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        toggle();
      } else if (event.key === "Escape" && active) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stop, toggle]);

  // Quiet the ordinary chrome while presenting.
  useEffect(() => {
    document.documentElement.dataset.demo = active ? "on" : "off";
  }, [active]);

  useEffect(() => clearTimers, [clearTimers]);

  // Leaving the demo's route by hand ends it — the story no longer matches.
  const routeAtStart = useRef(pathname);
  useEffect(() => {
    if (!active) routeAtStart.current = pathname;
  }, [active, pathname]);

  const value = useMemo<DemoValue>(
    () => ({
      active,
      phase: PHASES[phaseIndex],
      phaseIndex,
      phases: PHASES,
      progress: TOTAL_MS ? Math.min(1, elapsedMs / TOTAL_MS) : 0,
      elapsedMs,
      totalMs: TOTAL_MS,
      agents,
      metrics,
      atlasQuery,
      start,
      stop,
      toggle,
    }),
    [active, agents, atlasQuery, elapsedMs, metrics, phaseIndex, start, stop, toggle],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoValue {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo must be used inside DemoProvider");
  return context;
}
