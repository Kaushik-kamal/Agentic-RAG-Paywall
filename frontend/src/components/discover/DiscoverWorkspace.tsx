"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Coins,
  Gauge,
  Layers,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Square,
  TrendingUp,
} from "lucide-react";

import { BLUEPRINT, DiscoveryPipeline, type Stage, type StageId } from "./DiscoveryPipeline";
import { NetworkDemo } from "./NetworkDemo";
import { RankingBoard } from "./RankingBoard";
import { AnswerBody } from "@/components/console/AnswerBody";
import { CitationRail } from "@/components/console/CitationRail";
import { ConfidenceMeter } from "@/components/console/ConfidenceMeter";
import { PaywallDialog } from "@/components/console/PaywallDialog";
import { accentColor } from "@/components/marketplace/ProviderCard";
import { useSession } from "@/components/providers/SessionProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { Badge, Chip } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CodeBlock";
import { EmptyState, OfflineBanner } from "@/components/ui/Feedback";
import { Purpose } from "@/components/ui/Purpose";
import { StartDemoButton } from "@/components/demo/StartDemoButton";
import { ApiError } from "@/lib/api";
import { routeRequest, type RouteDone } from "@/lib/routeStream";
import type { Citation, Objective, RouteCandidate } from "@/lib/types";
import { cn, formatDuration, formatXlm } from "@/lib/utils";

const OBJECTIVES: { key: Objective; label: string; hint: string }[] = [
  { key: "balanced", label: "Balanced", hint: "Weigh capability, trust, price and speed" },
  { key: "quality", label: "Best answer", hint: "Prioritise capability and reputation" },
  { key: "cheapest", label: "Cheapest", hint: "Minimise cost within capable providers" },
  { key: "fastest", label: "Fastest", hint: "Minimise latency within capable providers" },
];

const EXAMPLES = [
  "Can I exclude liability for death caused by negligence?",
  "What is the number needed to treat, and why does it matter?",
  "How does Raft elect a leader after a partition?",
  "How long do I have to report a personal data breach?",
  "How do I calculate the weighted average cost of capital?",
  "Does a conference paper count as prior art?",
];

export function DiscoverWorkspace() {
  const { agentId, credits, offline, ready, getToken, refresh, setCredits } =
    useSession();
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [objective, setObjective] = useState<Objective>("balanced");
  const [running, setRunning] = useState(false);

  const [stages, setStages] = useState<Stage[]>([]);
  const [candidates, setCandidates] = useState<RouteCandidate[]>([]);
  const [chosen, setChosen] = useState<RouteCandidate | null>(null);
  const [runnerUp, setRunnerUp] = useState<RouteCandidate | null>(null);
  const [rationale, setRationale] = useState<string>("");
  const [tradeoffs, setTradeoffs] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>();

  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [activeMarker, setActiveMarker] = useState<number | null>(null);
  const [result, setResult] = useState<RouteDone | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(0);
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const mark = useCallback(
    (id: StageId, changes: Partial<Stage>) =>
      setStages((current) =>
        current.map((stage) =>
          stage.id === id
            ? {
                ...stage,
                ...changes,
                elapsedMs:
                  changes.state === "done" || changes.state === "failed"
                    ? performance.now() - startedRef.current
                    : stage.elapsedMs,
              }
            : stage,
        ),
      ),
    [],
  );

  const advance = useCallback(
    (id: StageId, detail?: string) => {
      setStages((current) => {
        const index = current.findIndex((stage) => stage.id === id);
        return current.map((stage, position) => {
          if (position < index && stage.state !== "done") {
            return { ...stage, state: "done" as const };
          }
          if (position === index) {
            return {
              ...stage,
              state: "active" as const,
              detail: detail ?? stage.detail,
            };
          }
          return stage;
        });
      });
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStages(BLUEPRINT.map((s) => ({ ...s, state: "idle" as const })));
    setCandidates([]);
    setChosen(null);
    setRunnerUp(null);
    setRationale("");
    setTradeoffs([]);
    setAnswer("");
    setCitations([]);
    setResult(null);
    setFollowUps([]);
    setActiveMarker(null);
  }, []);

  const run = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || running || !agentId) return;

      if (credits <= 0) {
        setPaywallOpen(true);
        return;
      }

      reset();
      setRunning(true);
      startedRef.current = performance.now();

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = await getToken();
        await routeRequest(
          { query: text, agent_id: agentId, objective },
          token,
          {
            onIntent: (p) => advance("intent", p.message),
            onDiscovered: (p) => {
              setCandidates(p.providers);
              mark("intent", { state: "done" });
              advance(
                "discovered",
                `${p.considered} providers listed, each publishing its own price, latency and capabilities`,
              );
            },
            onRanked: (p) => {
              setWeights(p.weights);
              mark("discovered", { state: "done" });
              advance(
                "ranked",
                `${p.shortlisted} of ${candidates.length || p.shortlisted} passed the capability gate · ranked for ${p.objective_label} in ${formatDuration(p.decided_in_ms)}`,
              );
            },
            onSelected: (p) => {
              setChosen(p.provider);
              setRunnerUp(p.runner_up);
              setRationale(p.rationale);
              setTradeoffs(p.tradeoffs);
              mark("ranked", { state: "done" });
              advance("selected", p.rationale);
            },
            onPayment: (p) => {
              if (p.stage === "authorising") {
                mark("selected", { state: "done" });
                advance("payment", p.message);
              } else {
                setCredits(p.credits_remaining ?? credits);
                mark("payment", {
                  state: "done",
                  detail: `${p.price_xlm} XLM authorised to ${p.provider} · ${p.credits} credits debited`,
                });
              }
            },
            onInvoking: (p) => advance("invoking", p.message),
            onRetrieval: (p) => {
              setCitations(p.citations);
              mark("invoking", {
                state: "done",
                detail: `${p.citations.length} passages retrieved from the provider's own scope`,
              });
              advance("answering", "Streaming a grounded answer");
            },
            onToken: (text) => setAnswer((current) => current + text),
            onFollowUps: setFollowUps,
            onDone: (payload) => {
              setResult(payload);
              setAnswer(payload.answer);
              setCitations(payload.citations);
              setCredits(payload.credits_remaining);
              mark("answering", {
                state: "done",
                detail: `${payload.metrics.chunks_cited} of ${payload.metrics.chunks_retrieved} passages cited · ${payload.confidence.percent}% confidence`,
              });
              refresh();
            },
            onError: (error) => {
              setStages((current) =>
                current.map((stage) =>
                  stage.state === "active"
                    ? { ...stage, state: "failed", detail: error.message }
                    : stage,
                ),
              );
              if (error.isPaymentRequired || error.code === "insufficient_credits") {
                setPaywallOpen(true);
              } else {
                toast({
                  tone: "error",
                  title: "Routing failed",
                  description: error.message,
                });
              }
            },
          },
          controller.signal,
        );
      } catch (error) {
        toast({
          tone: "error",
          title: "Routing failed",
          description:
            error instanceof ApiError ? error.message : "Unexpected failure.",
        });
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [
      advance,
      agentId,
      candidates.length,
      credits,
      getToken,
      mark,
      objective,
      refresh,
      reset,
      running,
      setCredits,
      toast,
    ],
  );

  useEffect(() => {
    if (answer && answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [answer]);

  const tone = chosen ? accentColor(chosen.accent) : "var(--accent)";

  return (
    <div className="shell py-10">
      <PaywallDialog
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="Providers set their own prices — the one the agent picked costs more credits than the balance covers."
      />

      <SectionHeader
        eyebrow="Autonomous discovery"
        title={
          <>
            The agent has never seen{" "}
            <span className="text-gradient">these providers</span>
          </>
        }
        description="Ask anything. The routing agent reads the registry, ranks every listed service on capability, trust, price and latency, explains its choice, pays, and returns the answer — with no hard-coded endpoint anywhere."
        actions={<StartDemoButton showHint />}
      />

      <Purpose className="mt-4">
        Autonomous selection, settlement and consumption of a service the agent has
        never seen.
      </Purpose>

      {offline ? <OfflineBanner className="mt-6" /> : null}

      {/* ── Composer ─────────────────────────────────────────────────────── */}
      <div className="mt-6">
        <div className="relative">
          <ScanSearch
            size={16}
            className="pointer-events-none absolute left-4 top-4 text-[var(--text-faint)]"
          />
          <textarea
            value={query}
            rows={2}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void run(query);
              }
            }}
            placeholder="Ask anything — the network will work out who can answer it…"
            aria-label="Request to route"
            className="field resize-none py-3.5 pl-11 pr-32 text-[0.9375rem]"
            disabled={running || !ready}
          />
          <div className="absolute bottom-2.5 right-2.5">
            {running ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<Square size={12} />}
                onClick={() => abortRef.current?.abort()}
              >
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                disabled={!query.trim() || !ready}
                onClick={() => void run(query)}
                icon={<ArrowUp size={13} />}
              >
                Route it
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-faint)]">Optimise for:</span>
          {OBJECTIVES.map((option) => (
            <Chip
              key={option.key}
              active={objective === option.key}
              onClick={() => setObjective(option.key)}
              title={option.hint}
            >
              {option.label}
            </Chip>
          ))}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--value)]">
            <Coins size={11} />
            {credits} credits
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <Chip
              key={example}
              onClick={() => {
                setQuery(example);
                void run(example);
              }}
              className="max-w-full"
            >
              <span className="truncate">{example}</span>
            </Chip>
          ))}
        </div>
      </div>

      {/* ── Routing theatre ──────────────────────────────────────────────── */}
      {stages.length === 0 ? (
        <Card className="mt-8">
          <EmptyState
            icon={<ScanSearch size={22} />}
            title="No endpoint is configured anywhere in this flow"
            description="Pick a question above. The agent discovers the network at request time, evaluates every provider on price, latency and reputation, and settles autonomously with whichever one wins."
          />
        </Card>
      ) : (
        <div className="mt-8 grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          {/* Pipeline + scoreboard */}
          <div className="space-y-4">
            <Card>
              <h3 className="mb-4 text-sm font-semibold">Routing pipeline</h3>
              <DiscoveryPipeline stages={stages} totalMs={result?.total_ms} />
            </Card>

            {candidates.length ? (
              <Card>
                <h3 className="mb-3 text-sm font-semibold">
                  Scoreboard
                  <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                    every provider considered
                  </span>
                </h3>
                <RankingBoard
                  candidates={candidates}
                  chosenSlug={chosen?.slug}
                  runnerUpSlug={runnerUp?.slug}
                  weights={weights}
                />
              </Card>
            ) : null}
          </div>

          {/* Decision + answer */}
          <div className="space-y-4">
            {chosen ? (
              <Card
                lit
                className="animate-rise"
                style={{ borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)" }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius)] text-sm font-bold"
                    style={{
                      background: `color-mix(in oklab, ${tone} 15%, transparent)`,
                      color: tone,
                    }}
                  >
                    {chosen.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-[var(--text)]">
                        {chosen.name}
                      </h3>
                      <Badge tone="accent">selected</Badge>
                      <Badge tone="neutral">{chosen.category}</Badge>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                      {rationale}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Fact
                    icon={<Layers size={11} />}
                    label="Intent match"
                    value={`${Math.round(chosen.scores.capability * 100)}%`}
                    tone="var(--accent)"
                  />
                  <Fact
                    icon={<ShieldCheck size={11} />}
                    label="Trust"
                    value={`${chosen.reputation.grade} · ${Math.round(chosen.reputation.trust * 100)}%`}
                    tone="var(--positive)"
                  />
                  <Fact
                    icon={<Coins size={11} />}
                    label="Cost"
                    value={`${formatXlm(chosen.price_xlm, 3)} XLM`}
                    tone="var(--value)"
                  />
                  <Fact
                    icon={<Gauge size={11} />}
                    label={result ? "Actual" : "Expected"}
                    value={formatDuration(
                      result?.invocation_ms ?? chosen.target_latency_ms,
                    )}
                    tone="var(--data)"
                  />
                </div>

                {tradeoffs.length ? (
                  <div className="mt-4 border-t border-[color:var(--line)] pt-3">
                    <p className="text-eyebrow mb-2">Trade-offs accepted</p>
                    <ul className="space-y-1.5">
                      {tradeoffs.map((tradeoff) => (
                        <li
                          key={tradeoff}
                          className="flex gap-2 text-xs leading-relaxed text-[var(--text-muted)]"
                        >
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--text-faint)]" />
                          {tradeoff}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Card>
            ) : null}

            {answer || running ? (
              <Card>
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles size={15} className="text-[var(--accent-strong)]" />
                  <span className="text-sm font-semibold">
                    {chosen ? `${chosen.name} responds` : "Response"}
                  </span>
                  {result ? (
                    <span className="ml-auto flex items-center gap-3">
                      <ConfidenceMeter confidence={result.confidence} compact />
                      <CopyButton value={answer} label="Copy" />
                    </span>
                  ) : null}
                </div>

                <div ref={answerRef} className="max-h-[26rem] overflow-y-auto">
                  <AnswerBody
                    content={answer}
                    streaming={running && !result}
                    activeMarker={activeMarker}
                    availableMarkers={citations.map((c) => c.marker)}
                    onCite={setActiveMarker}
                  />
                </div>

                {followUps.length ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[color:var(--line)] pt-3">
                    {followUps.map((question) => (
                      <Chip
                        key={question}
                        onClick={() => {
                          setQuery(question);
                          void run(question);
                        }}
                        className="max-w-full"
                      >
                        <span className="truncate">{question}</span>
                      </Chip>
                    ))}
                  </div>
                ) : null}
              </Card>
            ) : null}

            {citations.length ? (
              <Card>
                <CitationRail
                  citations={citations}
                  activeMarker={activeMarker}
                  onSelect={setActiveMarker}
                />
              </Card>
            ) : null}

            {result ? (
              <Card className="animate-rise">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp size={14} className="text-[var(--positive)]" />
                  Reputation updated
                </h3>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                  This transaction was written to {result.provider.name}&rsquo;s
                  reputation ledger. Its trust score is now{" "}
                  <strong className="text-[var(--text)]">
                    {result.reputation_after.grade} ·{" "}
                    {Math.round(result.reputation_after.trust * 100)}%
                  </strong>{" "}
                  over {result.reputation_after.observations} recorded call
                  {result.reputation_after.observations === 1 ? "" : "s"} — which will
                  influence the next routing decision.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Fact
                    label="Routing"
                    value={formatDuration(result.routing_ms)}
                    tone="var(--accent)"
                  />
                  <Fact
                    label="Invocation"
                    value={formatDuration(result.invocation_ms)}
                    tone="var(--data)"
                  />
                  <Fact
                    label="Paid"
                    value={`${formatXlm(result.price_xlm, 3)} XLM`}
                    tone="var(--value)"
                  />
                  <Fact
                    label="Credits left"
                    value={String(result.credits_remaining)}
                    tone="var(--positive)"
                  />
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      )}

      <NetworkDemo onFinished={() => void refresh()} />
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[var(--surface-raised)] p-2">
      <p
        className="flex items-center gap-1 text-[0.5625rem] font-semibold uppercase tracking-[0.06em]"
        style={{ color: tone }}
      >
        {icon}
        {label}
      </p>
      <p className={cn("text-numeric mt-1 truncate text-xs font-semibold text-[var(--text)]")}>
        {value}
      </p>
    </div>
  );
}
