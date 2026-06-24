"use client";

import { useState, useRef } from "react";
import {
  Bot, Send, CreditCard, Database, Zap,
  CheckCircle, XCircle, Loader2, ArrowDown,
  Copy, RefreshCw, ExternalLink,
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  getPaymentChallenge, verifyPayment, queryRAG,
  type PaymentChallenge, type VerifyPaymentResponse, type QueryResponse,
} from "@/lib/api";

// ── Demo step types ───────────────────────────────────────────────────────────

type StepStatus = "idle" | "active" | "done" | "error";

interface DemoStep {
  id: string;
  icon: React.ReactNode;
  label: string;
  sub: string;
  status: StepStatus;
}

// ── Animated step indicator ───────────────────────────────────────────────────

function StepNode({
  step,
  isLast,
}: {
  step: DemoStep;
  isLast: boolean;
}) {
  const iconMap: Record<StepStatus, React.ReactNode> = {
    idle:   <span className="w-3 h-3 rounded-full bg-slate-700" />,
    active: <Loader2 size={16} className="animate-spin text-violet-400" />,
    done:   <CheckCircle size={16} className="text-emerald-400" />,
    error:  <XCircle size={16} className="text-red-400" />,
  };

  const borderMap: Record<StepStatus, string> = {
    idle:   "border-slate-700",
    active: "border-violet-500 shadow-[0_0_20px_rgba(124,58,237,0.4)]",
    done:   "border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)]",
    error:  "border-red-500",
  };

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-4 w-full">
        {/* Icon circle */}
        <div
          className={`w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-500 ${borderMap[step.status]} bg-slate-900`}
        >
          {step.status === "idle" ? step.icon : iconMap[step.status]}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-semibold transition-colors duration-300 ${
              step.status === "done"  ? "text-emerald-300" :
              step.status === "active"? "text-violet-300"  :
              step.status === "error" ? "text-red-300"     : "text-slate-500"
            }`}
          >
            {step.label}
          </p>
          <p className="text-xs text-slate-600 truncate">{step.sub}</p>
        </div>
      </div>

      {/* Connector line */}
      {!isLast && (
        <div className="ml-6 w-0.5 h-8 my-1 bg-gradient-to-b from-slate-700 to-slate-800" />
      )}
    </div>
  );
}

// ── Code block ────────────────────────────────────────────────────────────────

function CodeBlock({
  title,
  code,
  highlight,
}: {
  title: string;
  code: string;
  highlight?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-xl overflow-hidden border border-white/10">
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/60" />
          <span className="ml-2 text-xs font-mono text-slate-500">{title}</span>
        </div>
        <button
          onClick={copy}
          className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
        >
          <Copy size={12} />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto bg-slate-950/50 text-slate-300">
        {code}
      </pre>
    </div>
  );
}

// ── Result panel ──────────────────────────────────────────────────────────────

function ResultPanel({
  challenge,
  verifyResult,
  answer,
  txHash,
}: {
  challenge: PaymentChallenge | null;
  verifyResult: VerifyPaymentResponse | null;
  answer: QueryResponse | null;
  txHash: string;
}) {
  if (challenge && !verifyResult) {
    return (
      <CodeBlock
        title="← HTTP 402 Payment Required"
        highlight="402"
        code={`HTTP/1.1 402 Payment Required
X-Payment-Address: ${challenge.destination.slice(0, 20)}...
X-Payment-Amount:  ${challenge.amount_xlm} XLM
X-Payment-Asset:   ${challenge.asset}
X-Payment-Network: ${challenge.network}
X-Payment-Memo:    ${challenge.memo}

{
  "destination": "${challenge.destination}",
  "amount_xlm":  ${challenge.amount_xlm},
  "memo":        "${challenge.memo}",
  "expires_at":  "${challenge.expires_at}"
}`}
      />
    );
  }

  if (verifyResult?.verified && !answer) {
    return (
      <CodeBlock
        title="✓ Payment Verified — Token Issued"
        code={`{
  "verified":     true,
  "access_token": "${verifyResult.access_token?.slice(0, 40)}...",
  "expires_in":   ${verifyResult.expires_in} seconds,
  "token_type":   "${verifyResult.token_type}"
}`}
      />
    );
  }

  if (answer) {
    return (
      <CodeBlock
        title="← HTTP 200 OK — RAG Answer"
        code={`{
  "answer": "${answer.answer.slice(0, 200)}${answer.answer.length > 200 ? "..." : ""}",
  "sources":      ${JSON.stringify(answer.sources)},
  "tokens_used":  ${answer.tokens_used},
  "cost_xlm":     ${answer.cost_xlm},
  "latency_s":    ${answer.latency_s ?? "~1.5"}
}`}
      />
    );
  }

  return (
    <div className="rounded-xl border border-white/5 bg-slate-950/30 p-6 text-center">
      <p className="text-slate-600 text-sm">Output will appear here during the demo</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DEMO_AGENT_ID = "agent_demo_001";
const PRESET_QUERIES = [
  "What is LangChain and how does it work?",
  "Explain the Stellar consensus protocol",
  "How does vector similarity search work?",
  "What are the benefits of RAG over fine-tuning?",
];

export default function DemoPage() {
  const [query, setQuery] = useState(PRESET_QUERIES[0]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [challenge, setChallenge]       = useState<PaymentChallenge | null>(null);
  const [txHash, setTxHash]             = useState("");
  const [verifyResult, setVerifyResult] = useState<VerifyPaymentResponse | null>(null);
  const [answer, setAnswer]             = useState<QueryResponse | null>(null);

  const [steps, setSteps] = useState<DemoStep[]>([
    { id: "query",   icon: <Bot size={18} className="text-slate-500" />,       label: "Agent Sends Query",          sub: "POST /api/v1/rag/query",             status: "idle" },
    { id: "http402", icon: <XCircle size={18} className="text-slate-500" />,   label: "HTTP 402 Received",           sub: "Payment challenge in headers",       status: "idle" },
    { id: "payment", icon: <CreditCard size={18} className="text-slate-500" />, label: "Stellar Micropayment",        sub: "0.01 XLM on testnet",                status: "idle" },
    { id: "verify",  icon: <CheckCircle size={18} className="text-slate-500" />,label: "Transaction Verified",        sub: "On-chain confirmation + JWT",        status: "idle" },
    { id: "rag",     icon: <Database size={18} className="text-slate-500" />,   label: "RAG Retrieval (ChromaDB)",    sub: "Semantic search + Gemini embedding", status: "idle" },
    { id: "answer",  icon: <Zap size={18} className="text-slate-500" />,        label: "Gemini Generates Answer",     sub: "gemini-2.0-flash",                   status: "idle" },
  ]);

  const setStepStatus = (id: string, status: StepStatus) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const reset = () => {
    setRunning(false);
    setError(null);
    setChallenge(null);
    setTxHash("");
    setVerifyResult(null);
    setAnswer(null);
    setSteps((prev) => prev.map((s) => ({ ...s, status: "idle" })));
  };

  const runDemo = async () => {
    if (!query.trim() || running) return;
    reset();
    setRunning(true);

    try {
      // ── Step 1: Agent sends query (expect 402) ─────────────────────────────
      setStepStatus("query", "active");
      await sleep(600);
      setStepStatus("query", "done");

      // ── Step 2: HTTP 402 received — get challenge ─────────────────────────
      setStepStatus("http402", "active");
      const ch = await getPaymentChallenge(DEMO_AGENT_ID);
      setChallenge(ch);
      await sleep(800);
      setStepStatus("http402", "done");

      // ── Step 3: Stellar payment (demo tx hash) ────────────────────────────
      setStepStatus("payment", "active");
      const demoTx = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      setTxHash(demoTx);
      await sleep(1800); // simulate 3-5s Stellar settlement
      setStepStatus("payment", "done");

      // ── Step 4: Verify transaction + get access token ─────────────────────
      setStepStatus("verify", "active");
      const vr = await verifyPayment({ transaction_hash: demoTx, agent_id: DEMO_AGENT_ID });
      setVerifyResult(vr);
      if (!vr.verified) throw new Error(vr.reason ?? "Verification failed");
      await sleep(600);
      setStepStatus("verify", "done");

      // ── Step 5: ChromaDB RAG retrieval ────────────────────────────────────
      setStepStatus("rag", "active");
      await sleep(800);

      // ── Step 6: Gemini generates answer ──────────────────────────────────
      setStepStatus("answer", "active");
      let result: QueryResponse;
      try {
        result = await queryRAG(
          { query, agent_id: DEMO_AGENT_ID },
          vr.access_token!
        );
      } catch {
        // Backend might not have Gemini key configured — use a rich demo answer
        result = {
          answer:
            "This is a demo answer generated by the Agentic RAG Paywall system. " +
            "In production, Gemini 2.0 Flash retrieves semantic chunks from ChromaDB " +
            "and synthesises a grounded, source-cited answer. " +
            "Configure GEMINI_API_KEY in backend/.env to enable live answers.",
          sources: ["demo_document.pdf#p1", "knowledge_base_chunk_42"],
          tokens_used: 512,
          cost_xlm: 0.01,
          latency_s: 1.4,
        };
      }
      setAnswer(result);
      setStepStatus("rag", "done");
      setStepStatus("answer", "done");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      // Mark the currently active step as error
      setSteps((prev) =>
        prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s))
      );
    } finally {
      setRunning(false);
    }
  };

  const allDone = steps.every((s) => s.status === "done");

  return (
    <>
      <Navbar />
      <main className="flex-1 pt-24 pb-16 px-6">
        <div className="max-w-6xl mx-auto">

          {/* Header */}
          <div className="text-center mb-12">
            <Badge variant="cyan" className="mb-4">
              <span className="pulse-dot violet" />
              Interactive Demo
            </Badge>
            <h1 className="section-heading mb-4">
              Watch an AI Agent <span className="gradient-text">Pay to Know</span>
            </h1>
            <p className="text-slate-400 max-w-xl mx-auto">
              Visualise the full x402 flow: Query → HTTP 402 → Stellar payment →
              Token → RAG retrieval → Gemini answer.
            </p>
          </div>

          {/* Query input */}
          <Card className="mb-8 border border-violet-500/20">
            <label className="block text-sm font-semibold text-slate-300 mb-3">
              Agent Query
            </label>
            {/* Preset chips */}
            <div className="flex flex-wrap gap-2 mb-3">
              {PRESET_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => setQuery(q)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                    query === q
                      ? "border-violet-500/60 bg-violet-500/15 text-violet-300"
                      : "border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <input
                id="demo-query-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !running && runDemo()}
                placeholder="Ask anything…"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50 transition-colors"
                disabled={running}
              />
              {allDone ? (
                <button
                  id="demo-reset-btn"
                  onClick={reset}
                  className="btn-secondary flex items-center gap-2 px-5"
                >
                  <RefreshCw size={16} />
                  Reset
                </button>
              ) : (
                <button
                  id="demo-run-btn"
                  onClick={runDemo}
                  disabled={running || !query.trim()}
                  className="btn-primary flex items-center gap-2 px-6 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {running ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                  {running ? "Running…" : "Run Demo"}
                </button>
              )}
            </div>
          </Card>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 rounded-xl border border-red-500/30 bg-red-500/10 flex items-start gap-3">
              <XCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-300 mb-1">Demo error</p>
                <p className="text-xs text-red-400/80">{error}</p>
              </div>
            </div>
          )}

          {/* Main demo layout */}
          <div className="grid lg:grid-cols-2 gap-8">

            {/* Left — step-by-step pipeline */}
            <div>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-5 flex items-center gap-2">
                <ArrowDown size={14} />
                Payment Flow Pipeline
              </h2>
              <div className="glass-card rounded-2xl p-6 space-y-0">
                {steps.map((step, i) => (
                  <StepNode key={step.id} step={step} isLast={i === steps.length - 1} />
                ))}
              </div>

              {/* Tx hash */}
              {txHash && (
                <div className="mt-4 p-4 rounded-xl border border-white/10 bg-white/[0.02]">
                  <p className="text-xs text-slate-500 mb-1">Demo Transaction Hash</p>
                  <p className="font-mono text-xs text-emerald-400 break-all">{txHash}</p>
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-violet-400 transition-colors"
                  >
                    <ExternalLink size={11} />
                    View on Stellar Expert (live tx only)
                  </a>
                </div>
              )}
            </div>

            {/* Right — live output */}
            <div>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-5 flex items-center gap-2">
                <Zap size={14} />
                HTTP Response
              </h2>

              <div className="space-y-4">
                <ResultPanel
                  challenge={challenge}
                  verifyResult={verifyResult}
                  answer={answer}
                  txHash={txHash}
                />

                {/* Answer card */}
                {answer && (
                  <Card className="border border-emerald-500/20">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle size={16} className="text-emerald-400" />
                      <span className="text-sm font-semibold text-emerald-300">
                        Gemini Answer
                      </span>
                      <Badge variant="green" className="ml-auto">
                        {answer.cost_xlm} XLM paid
                      </Badge>
                    </div>
                    <p className="text-slate-300 text-sm leading-relaxed">{answer.answer}</p>

                    {answer.sources.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-white/5">
                        <p className="text-xs text-slate-500 mb-2">Sources</p>
                        <div className="flex flex-wrap gap-2">
                          {answer.sources.map((src) => (
                            <span key={src} className="code-badge">{src}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-4 grid grid-cols-3 gap-3">
                      {[
                        { label: "Tokens", value: answer.tokens_used },
                        { label: "Latency", value: `${answer.latency_s ?? "~1.5"}s` },
                        { label: "Cost", value: `${answer.cost_xlm} XLM` },
                      ].map((m) => (
                        <div key={m.label} className="text-center p-2 rounded-lg bg-white/[0.03]">
                          <p className="text-xs text-slate-500">{m.label}</p>
                          <p className="text-sm font-mono font-semibold text-slate-200">{m.value}</p>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* How to integrate */}
                {allDone && (
                  <Card className="border border-blue-500/20">
                    <h3 className="text-sm font-semibold text-blue-300 mb-3 flex items-center gap-2">
                      <Bot size={15} />
                      Integrate in Your Agent
                    </h3>
                    <CodeBlock
                      title="agent_client.py"
                      code={`import httpx

BASE = "http://localhost:8000/api/v1"
AGENT_ID = "your_agent_id"

# 1. Get payment challenge
ch = httpx.post(f"{BASE}/payments/challenge",
    json={"agent_id": AGENT_ID}).json()

# 2. Pay on Stellar (use stellar-sdk)
tx_hash = pay_stellar(ch["destination"], ch["amount_xlm"])

# 3. Verify and get token
token = httpx.post(f"{BASE}/payments/verify",
    json={"transaction_hash": tx_hash,
          "agent_id": AGENT_ID}).json()["access_token"]

# 4. Query the knowledge base
answer = httpx.post(f"{BASE}/rag/query",
    json={"query": "Your question", "agent_id": AGENT_ID},
    headers={"Authorization": f"Bearer {token}"}).json()

print(answer["answer"])`}
                    />
                  </Card>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
