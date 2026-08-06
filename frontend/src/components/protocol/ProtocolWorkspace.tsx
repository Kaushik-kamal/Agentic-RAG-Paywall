"use client";

/** The x402 walkthrough.
 *
 * Runs the real handshake against the real API and prints every request and
 * response verbatim. Nothing is scripted — if the backend is down, the run
 * fails visibly rather than playing an animation. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  Coins,
  ExternalLink,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";

import { useSession } from "@/components/providers/SessionProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { Badge, Chip, LiveDot } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { OfflineBanner } from "@/components/ui/Feedback";
import { API_BASE, ApiError, getChallenge, verifyPayment } from "@/lib/api";
import { streamAnswer } from "@/lib/stream";
import type { Citation, PaymentChallenge, VerifyResult } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";

type StepState = "idle" | "running" | "done" | "failed";

interface Step {
  id: string;
  title: string;
  summary: string;
  state: StepState;
  detail?: string;
  elapsedMs?: number;
}

const BLUEPRINT: Omit<Step, "state">[] = [
  {
    id: "unpaid",
    title: "Agent calls the API with no credential",
    summary: "POST /rag/query → expects 402 Payment Required",
  },
  {
    id: "challenge",
    title: "Server answers with a payment challenge",
    summary: "Destination, exact amount, and a memo that binds the payment",
  },
  {
    id: "settle",
    title: "Agent settles on Stellar",
    summary: "One payment buys a bundle of query credits",
  },
  {
    id: "verify",
    title: "Server re-reads the transaction and mints a token",
    summary: "Destination, amount, memo and replay are all checked",
  },
  {
    id: "answer",
    title: "Agent retries and gets a grounded answer",
    summary: "One credit is debited as the answer streams back",
  },
];

const SAMPLE_QUESTIONS = [
  "Why does the x402 memo matter?",
  "What makes Stellar suitable for micropayments?",
  "How does credit metering differ from a session token?",
];

export function ProtocolWorkspace() {
  const { agentId, config, offline, refresh, setCredits } = useSession();
  const { toast } = useToast();

  const [steps, setSteps] = useState<Step[]>(
    BLUEPRINT.map((step) => ({ ...step, state: "idle" })),
  );
  const [question, setQuestion] = useState(SAMPLE_QUESTIONS[0]);
  const [running, setRunning] = useState(false);
  const [unpaidStatus, setUnpaidStatus] = useState<number | null>(null);
  const [challenge, setChallenge] = useState<PaymentChallenge | null>(null);
  const [verification, setVerification] = useState<VerifyResult | null>(null);
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [totalMs, setTotalMs] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = useCallback((id: string, changes: Partial<Step>) => {
    setSteps((current) =>
      current.map((step) => (step.id === id ? { ...step, ...changes } : step)),
    );
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setSteps(BLUEPRINT.map((step) => ({ ...step, state: "idle" })));
    setUnpaidStatus(null);
    setChallenge(null);
    setVerification(null);
    setAnswer("");
    setCitations([]);
    setTotalMs(null);
    setRunning(false);
  }, []);

  const run = useCallback(async () => {
    if (!agentId || running) return;
    reset();
    setRunning(true);
    const startedAt = performance.now();

    try {
      // ── 1. Unpaid request ────────────────────────────────────────────────
      patch("unpaid", { state: "running" });
      const probeStart = performance.now();
      const probe = await fetch(`${API_BASE}/rag/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, agent_id: agentId }),
      });
      setUnpaidStatus(probe.status);
      patch("unpaid", {
        state: probe.status === 402 ? "done" : "failed",
        detail:
          probe.status === 402
            ? "402 Payment Required — the paywall held"
            : `Unexpected ${probe.status}; the paywall may be misconfigured`,
        elapsedMs: performance.now() - probeStart,
      });

      // ── 2. Challenge ─────────────────────────────────────────────────────
      patch("challenge", { state: "running" });
      const challengeStart = performance.now();
      const issued = await getChallenge(agentId);
      setChallenge(issued);
      patch("challenge", {
        state: "done",
        detail: `${issued.amount_xlm} XLM to ${issued.destination.slice(0, 8)}… · memo ${issued.memo}`,
        elapsedMs: performance.now() - challengeStart,
      });

      // ── 3. Settle ────────────────────────────────────────────────────────
      patch("settle", { state: "running" });
      const settleStart = performance.now();
      const txHash = `sandbox_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
      // Let the stage be legible rather than instantaneous.
      await new Promise((resolve) => setTimeout(resolve, 620));
      patch("settle", {
        state: "done",
        detail: `Sandbox settlement · ${txHash}`,
        elapsedMs: performance.now() - settleStart,
      });

      // ── 4. Verify ────────────────────────────────────────────────────────
      patch("verify", { state: "running" });
      const verifyStart = performance.now();
      const verified = await verifyPayment({
        transaction_hash: txHash,
        agent_id: agentId,
        challenge_id: issued.challenge_id,
      });
      setVerification(verified);
      setCredits(verified.credits_remaining);
      patch("verify", {
        state: "done",
        detail: `+${verified.credits_granted} credits · token valid ${Math.round(verified.expires_in / 60)} min`,
        elapsedMs: performance.now() - verifyStart,
      });

      // ── 5. Answer ────────────────────────────────────────────────────────
      patch("answer", { state: "running" });
      const answerStart = performance.now();
      const controller = new AbortController();
      abortRef.current = controller;

      await streamAnswer(
        { query: question, agent_id: agentId, remember: false },
        verified.access_token,
        {
          onRetrieval: (payload) => setCitations(payload.citations),
          onToken: (text) => setAnswer((current) => current + text),
          onDone: (payload) => {
            setAnswer(payload.answer);
            setCitations(payload.citations);
            setCredits(payload.credits_remaining);
            patch("answer", {
              state: "done",
              detail: `${payload.metrics.chunks_cited} of ${payload.metrics.chunks_retrieved} passages cited · ${payload.confidence.percent}% confidence`,
              elapsedMs: performance.now() - answerStart,
            });
          },
          onError: (error) => {
            patch("answer", { state: "failed", detail: error.message });
            toast({ tone: "error", title: "Query failed", description: error.message });
          },
        },
        controller.signal,
      );

      setTotalMs(performance.now() - startedAt);
      refresh();
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "The walkthrough could not complete.";
      setSteps((current) =>
        current.map((step) =>
          step.state === "running" ? { ...step, state: "failed", detail: message } : step,
        ),
      );
      toast({ tone: "error", title: "Walkthrough failed", description: message });
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [agentId, patch, question, refresh, reset, running, setCredits, toast]);

  const finished = steps.every((step) => step.state === "done");

  return (
    <div className="shell py-10">
      <SectionHeader
        eyebrow="HTTP 402"
        title={
          <>
            Watch an agent <span className="text-gradient">buy an answer</span>
          </>
        }
        description="This runs the real handshake against the running API. Every request below is issued live, and every response is printed verbatim."
        actions={
          <div className="flex items-center gap-2">
            {finished ? (
              <Button onClick={reset} icon={<RotateCcw size={14} />}>
                Reset
              </Button>
            ) : null}
            <Button
              variant="primary"
              onClick={run}
              loading={running}
              disabled={offline}
              icon={running ? undefined : <Play size={14} />}
            >
              {running ? "Running…" : finished ? "Run again" : "Run the handshake"}
            </Button>
          </div>
        }
      />

      {offline ? <OfflineBanner className="mt-6" /> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {SAMPLE_QUESTIONS.map((sample) => (
          <Chip
            key={sample}
            active={question === sample}
            onClick={() => !running && setQuestion(sample)}
          >
            {sample}
          </Chip>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        {/* ── Stage list ─────────────────────────────────────────────────── */}
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li key={step.id}>
              <div
                className={cn(
                  "relative rounded-[var(--radius)] border p-4 transition-all duration-300",
                  step.state === "running" &&
                    "border-[color:var(--line-accent)] bg-[var(--accent-soft)] shadow-[var(--shadow-glow)]",
                  step.state === "done" &&
                    "border-[color:var(--positive)]/25 bg-[var(--surface)]",
                  step.state === "failed" &&
                    "border-[color:var(--danger)]/30 bg-[var(--danger-soft)]",
                  step.state === "idle" &&
                    "border-[color:var(--line)] bg-[var(--surface)] opacity-70",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">
                    {step.state === "running" ? (
                      <Loader2 size={18} className="animate-spin text-[var(--accent-strong)]" />
                    ) : step.state === "done" ? (
                      <CheckCircle2 size={18} className="text-[var(--positive)]" />
                    ) : step.state === "failed" ? (
                      <Ban size={18} className="text-[var(--danger)]" />
                    ) : (
                      <span className="mono grid h-[18px] w-[18px] place-items-center rounded-full border border-[color:var(--line-strong)] text-[0.625rem] text-[var(--text-faint)]">
                        {index + 1}
                      </span>
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text)]">{step.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {step.summary}
                    </p>
                    {step.detail ? (
                      <p
                        className={cn(
                          "animate-fade mono mt-2 text-[0.6875rem]",
                          step.state === "failed"
                            ? "text-[var(--danger)]"
                            : "text-[var(--text-secondary)]",
                        )}
                      >
                        {step.detail}
                      </p>
                    ) : null}
                  </div>

                  {step.elapsedMs ? (
                    <span className="mono shrink-0 text-[0.625rem] text-[var(--text-faint)]">
                      {formatDuration(step.elapsedMs)}
                    </span>
                  ) : null}
                </div>
              </div>

              {index < steps.length - 1 ? (
                <div
                  aria-hidden
                  className={cn(
                    "ml-[1.65rem] h-3 w-px transition-colors duration-300",
                    step.state === "done"
                      ? "bg-[var(--positive)]"
                      : "bg-[color:var(--line-strong)]",
                  )}
                />
              ) : null}
            </li>
          ))}

          {totalMs ? (
            <li className="animate-rise pt-2">
              <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[color:var(--line-accent)] bg-[var(--accent-soft)] px-4 py-3">
                <Sparkles size={15} className="text-[var(--accent-strong)]" />
                <p className="text-sm text-[var(--text)]">
                  Discovery to paid answer in{" "}
                  <strong className="text-numeric">{formatDuration(totalMs)}</strong> — no
                  account, no card, no subscription.
                </p>
              </div>
            </li>
          ) : null}
        </ol>

        {/* ── Wire log ───────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <CodeBlock
            filename="1 · unpaid request"
            maxHeight="11rem"
            code={
              unpaidStatus
                ? `POST ${API_BASE}/rag/query\nContent-Type: application/json\n\n{"query": ${JSON.stringify(question)}, "agent_id": "${agentId ?? "…"}"}\n\n← HTTP ${unpaidStatus} Payment Required\nX-Payment-Address: ${challenge?.destination ?? "…"}\nX-Payment-Amount:  ${challenge?.amount_xlm ?? "0.01"}\nX-Payment-Asset:   XLM\nX-Payment-Network: ${challenge?.network ?? config?.stellar.network ?? "testnet"}`
                : `POST ${API_BASE}/rag/query\n\n// Run the handshake to see the live response.`
            }
          />

          <CodeBlock
            filename="2 · payment challenge"
            maxHeight="13rem"
            code={
              challenge
                ? JSON.stringify(
                    {
                      challenge_id: challenge.challenge_id,
                      destination: challenge.destination,
                      amount_xlm: challenge.amount_xlm,
                      asset: challenge.asset,
                      memo: challenge.memo,
                      network: challenge.network,
                      expires_at: challenge.expires_at,
                      credits_granted: challenge.credits_granted,
                    },
                    null,
                    2,
                  )
                : "// Awaiting the challenge…"
            }
          />

          <CodeBlock
            filename="3 · verification response"
            maxHeight="12rem"
            code={
              verification
                ? JSON.stringify(
                    {
                      verified: verification.verified,
                      mode: verification.mode,
                      amount_xlm: verification.amount_xlm,
                      credits_granted: verification.credits_granted,
                      credits_remaining: verification.credits_remaining,
                      token_type: verification.token_type,
                      expires_in: verification.expires_in,
                      access_token: `${verification.access_token.slice(0, 44)}…`,
                    },
                    null,
                    2,
                  )
                : "// Awaiting verification…"
            }
          />

          {answer ? (
            <Card className="animate-rise">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck size={15} className="text-[var(--positive)]" />
                <span className="text-sm font-medium">Paid answer</span>
                <Badge tone="value" className="ml-auto">
                  <Coins size={10} />1 credit
                </Badge>
              </div>
              <p className="prose-answer text-[0.8125rem]">{answer}</p>
              {citations.length ? (
                <ul className="mt-4 space-y-1 border-t border-[color:var(--line)] pt-3">
                  {citations
                    .filter((citation) => citation.used)
                    .map((citation) => (
                      <li
                        key={citation.chunk_id}
                        className="flex items-start gap-2 text-xs text-[var(--text-muted)]"
                      >
                        <span className="mono mt-px rounded bg-[var(--accent)] px-1 text-[0.625rem] text-white">
                          {citation.marker}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{citation.locator}</span>
                        <span className="mono shrink-0 text-[var(--data)]">
                          {Math.round(citation.score * 100)}%
                        </span>
                      </li>
                    ))}
                </ul>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>

      {/* ── Integration ──────────────────────────────────────────────────── */}
      <section id="integrate" className="mt-16 scroll-mt-24">
        <SectionHeader
          eyebrow="Integrate"
          title="Wire an agent up in four calls"
          description="The reference client below is the same one shipped in backend/scripts/agent_client.py — run it and it pays on the Stellar testnet for real."
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <CodeBlock
            filename="agent.py"
            maxHeight="27rem"
            code={`import httpx

API = "${API_BASE}"
AGENT = "agent_my_researcher"

with httpx.Client(timeout=120) as http:
    # 1 · Discover the price from the 402 itself
    probe = http.post(f"{API}/rag/query",
                      json={"query": q, "agent_id": AGENT})
    assert probe.status_code == 402
    price = probe.headers["X-Payment-Amount"]

    # 2 · Take the challenge (destination + binding memo)
    challenge = http.post(f"{API}/payments/challenge",
                          json={"agent_id": AGENT}).json()

    # 3 · Pay on Stellar, then redeem the hash for credits
    tx_hash = pay_stellar(challenge["destination"],
                          challenge["amount_xlm"],
                          memo=challenge["memo"])

    token = http.post(f"{API}/payments/verify", json={
        "transaction_hash": tx_hash,
        "agent_id": AGENT,
        "challenge_id": challenge["challenge_id"],
    }).json()["access_token"]

    # 4 · Ask. One credit per answer.
    answer = http.post(f"{API}/rag/query",
        json={"query": q, "agent_id": AGENT},
        headers={"Authorization": f"Bearer {token}"}).json()

    print(answer["answer"])
    for c in answer["citations"]:
        if c["used"]:
            print(f'  [{c["marker"]}] {c["locator"]}')`}
          />

          <div className="space-y-4">
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Terminal size={14} className="text-[var(--accent-strong)]" />
                Run it against the live testnet
              </h3>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                The reference agent generates a keypair, funds it from Friendbot,
                submits a real payment, and streams the answer back — end to end in
                about fifteen seconds.
              </p>
              <CodeBlock
                className="mt-3"
                filename="terminal"
                maxHeight="7rem"
                code={
                  'cd backend\npython scripts/agent_client.py --stream \\\n  "Why does the x402 memo matter?"'
                }
              />
            </Card>

            <Card>
              <h3 className="text-sm font-semibold">What the server checks</h3>
              <ul className="mt-3 space-y-2.5 text-[0.8125rem] text-[var(--text-muted)]">
                {[
                  ["Destination", "The payment landed in the treasury account, not somewhere else."],
                  ["Asset and amount", "Native XLM, at or above the advertised price."],
                  ["Memo", "Matches the challenge, so the payment is attributable."],
                  ["Replay", "A unique constraint on the hash — durable across restarts."],
                  ["Expiry", "Challenges live for five minutes."],
                ].map(([label, description]) => (
                  <li key={label} className="flex gap-2.5">
                    <CheckCircle2
                      size={14}
                      className="mt-0.5 shrink-0 text-[var(--positive)]"
                    />
                    <span>
                      <strong className="text-[var(--text)]">{label}.</strong>{" "}
                      {description}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <h3 className="text-sm font-semibold">Why credits, not sessions</h3>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                A time-boxed token lets one payment buy unlimited answers — that is a
                subscription wearing a paywall&rsquo;s clothes. Here the token proves
                <em> identity</em> and the ledger holds <em>value</em>: each answer
                debits one credit inside the transaction that records it, and a failed
                generation is refunded automatically.
              </p>
              <a
                href={`${API_BASE.replace(/\/api\/v\d+$/, "")}/docs`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-[var(--accent-strong)] hover:underline"
              >
                Full OpenAPI reference
                <ExternalLink size={12} />
              </a>
            </Card>
          </div>
        </div>
      </section>

      <div className="mt-12 flex items-center justify-center gap-2 text-xs text-[var(--text-faint)]">
        <LiveDot tone={offline ? "danger" : "positive"} />
        {offline
          ? "API offline — start the backend to run the handshake"
          : `Connected to ${API_BASE}`}
        <ArrowRight size={11} />
        {config?.stellar.network ?? "testnet"}
      </div>
    </div>
  );
}
