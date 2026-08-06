import Link from "next/link";
import {
  ArrowRight,
  Ban,
  Binary,
  Coins,
  FileSearch,
  Gauge,
  Layers,
  Quote,
  RefreshCcw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Terminal,
  Timer,
  Wallet,
} from "lucide-react";

import { LivePulse } from "@/components/landing/LivePulse";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { CodeBlock } from "@/components/ui/CodeBlock";

const CAPABILITIES = [
  {
    icon: Coins,
    title: "Priced in the response",
    body: "An unpaid call returns 402 with the address, the exact amount, and a memo that binds the payment to the request. Agents discover the price from the endpoint, not a pricing page.",
    accent: "var(--value)",
  },
  {
    icon: ShieldCheck,
    title: "Credits, not sessions",
    body: "The token proves identity; the ledger holds value. Each answer debits one credit inside the transaction that records it, so a stolen token buys nothing once the balance is spent.",
    accent: "var(--accent)",
  },
  {
    icon: Layers,
    title: "Hybrid retrieval",
    body: "Dense Gemini embeddings fused with BM25 through Reciprocal Rank Fusion. Paraphrase and rare literal tokens both land — and the fusion is visible in the UI.",
    accent: "var(--data)",
  },
  {
    icon: Quote,
    title: "Citations that resolve",
    body: "Every claim carries a marker that opens the exact passage: document, section breadcrumb, page number, and similarity score.",
    accent: "var(--positive)",
  },
  {
    icon: Gauge,
    title: "Confidence you can audit",
    body: "Scored from retrieval similarity and citation coverage — never the model's own self-assessment, which is poorly calibrated. Expand it to see every input.",
    accent: "var(--accent)",
  },
  {
    icon: RefreshCcw,
    title: "Failure is free",
    body: "If generation fails or the connection drops mid-stream, the credit is refunded automatically. Retrying is always safe.",
    accent: "var(--data)",
  },
] as const;

const PIPELINE = [
  { icon: FileSearch, label: "Parse", note: "PDF · DOCX · MD · TXT · CSV" },
  { icon: Layers, label: "Chunk", note: "Heading-aware, sentence overlap" },
  { icon: Binary, label: "Embed", note: "Gemini · 3072-dim vectors" },
  { icon: ScanSearch, label: "Retrieve", note: "Dense + BM25 · RRF fusion" },
  { icon: Sparkles, label: "Ground", note: "Numbered context, forced citations" },
  { icon: Gauge, label: "Score", note: "Confidence from evidence" },
] as const;

const COMPARISON = [
  ["Signup required", "Yes", "Yes", "No"],
  ["Cost per call", "Amortised", "$0.30 + 2.9%", "~$0.0000011"],
  ["Settlement", "Monthly invoice", "2–7 days", "~5 seconds"],
  ["Works for an agent", "No", "No", "Yes"],
] as const;

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pb-20 pt-20 md:pt-28">
        <div className="shell relative">
          <div className="mx-auto max-w-3xl text-center">
            <Badge tone="accent" className="mb-6">
              <Sparkles size={11} />
              HTTP 402 · Stellar · Gemini
            </Badge>

            <h1 className="text-display">
              A knowledge API that{" "}
              <span className="text-gradient">agents pay for</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
              No account. No card. No subscription. An autonomous agent calls the
              endpoint, reads the price off a{" "}
              <span className="mono rounded bg-[var(--surface-active)] px-1.5 py-0.5 text-[0.9em] text-[var(--value)]">
                402
              </span>
              , settles a micropayment on Stellar, and gets back an answer that cites
              its sources — in about five seconds.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink
                href="/console"
                variant="primary"
                size="lg"
                iconRight={<ArrowRight size={16} />}
              >
                Open the console
              </ButtonLink>
              <ButtonLink href="/protocol" size="lg" icon={<Wallet size={15} />}>
                Watch an agent pay
              </ButtonLink>
            </div>

            <p className="mt-4 text-xs text-[var(--text-faint)]">
              Three free credits on arrival — no wallet needed to try it.
            </p>
          </div>

          <LivePulse />
        </div>
      </section>

      {/* ── The handshake ─────────────────────────────────────────────────── */}
      <section className="shell py-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <SectionHeader
              eyebrow="The handshake"
              title={
                <>
                  Payment is part of{" "}
                  <span className="text-gradient">the protocol</span>
                </>
              }
              description="402 Payment Required sat unused in the HTTP spec for thirty years. It turns out to be exactly the right primitive when the client is software with a wallet and no patience for a signup form."
            />

            <ol className="mt-7 space-y-4">
              {[
                ["Call", "The agent requests an answer with no credential."],
                ["402", "The server replies with destination, amount, and memo."],
                ["Settle", "The agent pays on Stellar. Ledger closes in ~5s."],
                ["Redeem", "The hash is verified on-chain and buys query credits."],
                ["Answer", "The retry streams back, cited, one credit spent."],
              ].map(([label, description], index) => (
                <li key={label} className="flex gap-4">
                  <span className="mono grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[color:var(--line-accent)] bg-[var(--accent-soft)] text-[0.6875rem] font-semibold text-[var(--accent-strong)]">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">{label}</p>
                    <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                      {description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <ButtonLink
              href="/protocol"
              className="mt-7"
              iconRight={<ArrowRight size={14} />}
            >
              Run it live
            </ButtonLink>
          </div>

          <CodeBlock
            filename="the wire"
            maxHeight="30rem"
            code={`$ curl -X POST localhost:8000/api/v1/rag/query \\
       -d '{"query":"Why does the memo matter?",
            "agent_id":"agent_researcher"}'

← HTTP/1.1 402 Payment Required
  X-Payment-Address:   GAGKTSAT…K4J63NWKH
  X-Payment-Amount:    0.01
  X-Payment-Asset:     XLM
  X-Payment-Network:   testnet
  X-Payment-Memo:      x402-9f3a21c8
  X-Payment-Credits:   10

# agent signs and submits on Stellar … 3.1s

$ curl -X POST …/payments/verify \\
       -d '{"transaction_hash":"11d2e29a…",
            "agent_id":"agent_researcher",
            "challenge_id":"chal_4b7e…"}'

← HTTP/1.1 200 OK
  { "verified": true,
    "mode": "live",
    "credits_granted": 10,
    "access_token": "argp.eyJhaWQiOi…" }

$ curl …/rag/query -H "Authorization: Bearer argp.…"

← HTTP/1.1 200 OK
  { "answer": "A memo attributes an incoming
       payment to a specific challenge [1]…",
    "citations": [
      { "marker": 1,
        "locator": "The Stellar Network › Memos",
        "score": 0.85, "used": true } ],
    "confidence": { "percent": 89,
                    "label": "High confidence" },
    "cost_xlm": 0.01,
    "credits_remaining": 9 }`}
          />
        </div>
      </section>

      {/* ── Capabilities ──────────────────────────────────────────────────── */}
      <section className="shell py-16">
        <SectionHeader
          eyebrow="What is actually built"
          title={
            <>
              Engineering the demo{" "}
              <span className="text-gradient">does not hide</span>
            </>
          }
          description="Each of these is inspectable in the running product — not a claim on a slide."
        />

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, title, body, accent }) => (
            <Card key={title} interactive className="group">
              <span
                className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] transition-transform duration-300 group-hover:scale-105"
                style={{
                  background: `color-mix(in oklab, ${accent} 14%, transparent)`,
                  color: accent,
                }}
              >
                <Icon size={18} />
              </span>
              <h3 className="mt-4 text-[0.9375rem] font-semibold text-[var(--text)]">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
                {body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Pipeline ──────────────────────────────────────────────────────── */}
      <section className="shell py-16">
        <SectionHeader
          eyebrow="Retrieval pipeline"
          title="From a dropped file to a cited claim"
          description="Six stages, all instrumented. The console shows you the trace for every answer: what each retriever ranked, how fusion reordered it, and why a candidate was dropped."
        />

        <div className="panel edge-lit mt-8 overflow-hidden p-6 md:p-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {PIPELINE.map(({ icon: Icon, label, note }, index) => (
              <div key={label} className="relative">
                <div className="rounded-[var(--radius)] border border-[color:var(--line)] bg-[var(--surface-raised)] p-4 transition-colors duration-200 hover:border-[color:var(--line-accent)]">
                  <div className="flex items-center gap-2 text-[var(--accent-strong)]">
                    <Icon size={15} />
                    <span className="mono text-[0.625rem] text-[var(--text-faint)]">
                      0{index + 1}
                    </span>
                  </div>
                  <p className="mt-2.5 text-sm font-medium text-[var(--text)]">{label}</p>
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--text-muted)]">
                    {note}
                  </p>
                </div>
                {index < PIPELINE.length - 1 ? (
                  <ArrowRight
                    size={13}
                    aria-hidden
                    className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-[var(--text-faint)] lg:block"
                  />
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-3 border-t border-[color:var(--line)] pt-6 sm:grid-cols-3">
            {[
              [Timer, "Streaming", "Tokens arrive as they are generated; the retrieval trace lands before the first word."],
              [Ban, "No hallucination budget", "The model answers only from numbered context and is told to refuse when it cannot."],
              [Terminal, "Free retrieval", "Semantic search costs nothing — you only pay when a model writes."],
            ].map(([Icon, title, body]) => {
              const Component = Icon as typeof Timer;
              return (
                <div key={title as string} className="flex gap-3">
                  <Component size={15} className="mt-0.5 shrink-0 text-[var(--data)]" />
                  <div>
                    <p className="text-[0.8125rem] font-medium text-[var(--text)]">
                      {title as string}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
                      {body as string}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Comparison ────────────────────────────────────────────────────── */}
      <section className="shell py-16">
        <SectionHeader
          eyebrow="Why not just use Stripe"
          title="Because the buyer is not a person"
          description="Card rails assume a human who can wait days for settlement and accept a fixed fee larger than the purchase. Neither holds when a research agent needs one answer from an API it discovered thirty seconds ago."
        />

        <div className="panel mt-8 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-[color:var(--line)]">
                <th className="px-5 py-3 text-left font-medium text-[var(--text-muted)]">
                  &nbsp;
                </th>
                <th className="px-5 py-3 text-left font-medium text-[var(--text-muted)]">
                  API key + invoice
                </th>
                <th className="px-5 py-3 text-left font-medium text-[var(--text-muted)]">
                  Card per call
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent-strong)]">
                  x402 on Stellar
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(([label, a, b, c]) => (
                <tr
                  key={label}
                  className="border-b border-[color:var(--line)] last:border-0"
                >
                  <td className="px-5 py-3 font-medium text-[var(--text)]">{label}</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">{a}</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">{b}</td>
                  <td className="px-5 py-3">
                    <span className="font-medium text-[var(--positive)]">{c}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="shell pb-8 pt-10">
        <div className="panel edge-lit relative overflow-hidden px-6 py-14 text-center md:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-24 h-48 opacity-30 blur-3xl"
            style={{
              background:
                "radial-gradient(ellipse at center, var(--accent), transparent 70%)",
            }}
          />
          <div className="relative">
            <h2 className="text-title">
              Ask it something{" "}
              <span className="text-gradient">right now</span>
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
              The knowledge base ships seeded with primary material on Stellar
              consensus, the x402 protocol, retrieval architecture, and agent
              economics. Or drop in your own PDF and query that instead.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink
                href="/console"
                variant="primary"
                size="lg"
                iconRight={<ArrowRight size={16} />}
              >
                Open the console
              </ButtonLink>
              <ButtonLink href="/library" size="lg">
                Upload a document
              </ButtonLink>
            </div>
            <p className="mt-6 text-xs text-[var(--text-faint)]">
              Press{" "}
              <kbd className="kbd">⌘K</kbd> anywhere to search the knowledge base
            </p>
          </div>
        </div>
      </section>

      <p className="shell pb-4 text-center text-xs text-[var(--text-faint)]">
        Built as an open, inspectable reference for the agentic economy ·{" "}
        <Link href="/dashboard" className="hover:text-[var(--text-secondary)]">
          see the live numbers
        </Link>
      </p>
    </>
  );
}
