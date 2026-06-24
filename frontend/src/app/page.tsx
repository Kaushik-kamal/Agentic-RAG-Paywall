"use client";

import Link from "next/link";
import {
  ArrowRight, Zap, Bot, Database, CreditCard, Lock, Shield,
  ChevronRight, BookOpen, Cpu, Layers, Globe
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative pt-40 pb-28 px-6 overflow-hidden">
      {/* Radial glow orbs */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-40 left-1/4 w-[300px] h-[300px] bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-5xl mx-auto text-center">
        <Badge variant="violet" className="mb-8 inline-flex">
          <span className="pulse-dot violet" />
          Powered by Stellar x402 Micropayments
        </Badge>

        <h1 className="hero-heading mb-6">
          AI Agents Pay to{" "}
          <span className="gradient-text">Access Knowledge</span>
        </h1>

        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          A RAG-powered knowledge API where autonomous agents authenticate via
          Stellar micropayments. No subscriptions. No API keys. Just{" "}
          <span className="text-cyan-400 font-semibold">pay-per-query</span> intelligence.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/demo" className="btn-primary text-base px-8 py-3.5 gap-2">
            Watch AI Agent Demo
            <ArrowRight size={18} />
          </Link>
          <Link href="/dashboard" className="btn-secondary text-base px-8 py-3.5">
            View Dashboard
          </Link>
        </div>

        {/* Floating stat pills */}
        <div className="flex flex-wrap items-center justify-center gap-6 mt-16">
          {[
            { label: "Avg Query Cost", value: "0.01 XLM", icon: <CreditCard size={14} /> },
            { label: "Response Time", value: "< 2s",      icon: <Zap size={14} /> },
            { label: "Powered by",    value: "Gemini",    icon: <Cpu size={14} /> },
          ].map((stat) => (
            <div key={stat.label} className="glass-card gradient-border rounded-xl px-5 py-3 flex items-center gap-3">
              <span className="text-violet-400">{stat.icon}</span>
              <span className="text-slate-400 text-sm">{stat.label}:</span>
              <span className="text-white font-semibold text-sm">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── How It Works ──────────────────────────────────────────────────────────────

const steps = [
  {
    step: "01",
    icon: <Bot size={28} />,
    title: "Agent Sends Query",
    description:
      "An autonomous AI agent (or your own code) sends a natural-language question to the /rag/query endpoint. The server responds with HTTP 402 Payment Required.",
    accent: "violet" as const,
    code: `POST /api/v1/rag/query
{ "query": "What is quantum entanglement?",
  "agent_id": "agent_abc123" }

← HTTP 402 Payment Required
  X-Payment-Address: GCEX...
  X-Payment-Amount: 0.01 XLM`,
  },
  {
    step: "02",
    icon: <CreditCard size={28} />,
    title: "Stellar Micropayment",
    description:
      "The agent reads the 402 challenge, signs a Stellar transaction for 0.01 XLM, and submits it to the Stellar testnet in under 5 seconds.",
    accent: "blue" as const,
    code: `// Agent pays automatically
const tx = new StellarTransaction()
  .addOperation(Payment({
    destination: "GCEX...",
    asset: Asset.native(),
    amount: "0.01"
  }))
  .sign(agentKeyPair)
  .submit(server)`,
  },
  {
    step: "03",
    icon: <Database size={28} />,
    title: "RAG Knowledge Retrieval",
    description:
      "FastAPI verifies the transaction on-chain. LangChain queries ChromaDB with Gemini embeddings to retrieve the most relevant document chunks.",
    accent: "cyan" as const,
    code: `# Verified ✓ → RAG pipeline
embeddings = GeminiEmbeddings()
retriever  = chroma.as_retriever(k=5)
chain = RetrievalQA.from_chain_type(
  llm=Gemini("gemini-2.0-flash"),
  retriever=retriever
)
answer = chain.invoke(query)`,
  },
  {
    step: "04",
    icon: <Zap size={28} />,
    title: "Answer Delivered",
    description:
      "Gemini synthesises an answer from retrieved chunks. The full response, sources, and token usage are streamed back to the agent.",
    accent: "violet" as const,
    code: `← HTTP 200 OK
{
  "answer": "Quantum entanglement is...",
  "sources": ["physics_101.pdf#p12"],
  "tokens_used": 847,
  "cost_xlm": 0.01
}`,
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <Badge variant="cyan" className="mb-4">How It Works</Badge>
          <h2 className="section-heading mb-4">
            From Question to <span className="gradient-text">Paid Answer</span>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Four steps from raw query to verified micropayment to Gemini-synthesised answer.
          </p>
        </div>

        <div className="space-y-6">
          {steps.map((step, i) => (
            <div key={step.step} className="grid md:grid-cols-2 gap-6 items-start">
              {/* Info card */}
              <Card
                glow={i % 2 === 0 ? "violet" : "blue"}
                className={`${i % 2 === 1 ? "md:order-2" : ""}`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`p-3 rounded-xl flex-shrink-0 ${
                      step.accent === "violet"
                        ? "bg-violet-500/15 text-violet-400"
                        : step.accent === "blue"
                        ? "bg-blue-500/15 text-blue-400"
                        : "bg-cyan-500/15 text-cyan-400"
                    }`}
                  >
                    {step.icon}
                  </div>
                  <div>
                    <span className="text-xs font-mono text-slate-600 mb-1 block">
                      Step {step.step}
                    </span>
                    <h3 className="text-xl font-bold text-white mb-3">{step.title}</h3>
                    <p className="text-slate-400 leading-relaxed text-sm">{step.description}</p>
                  </div>
                </div>
              </Card>

              {/* Code block */}
              <div
                className={`glass-card rounded-2xl overflow-hidden ${
                  i % 2 === 1 ? "md:order-1" : ""
                }`}
              >
                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                  <span className="w-3 h-3 rounded-full bg-red-400/70" />
                  <span className="w-3 h-3 rounded-full bg-amber-400/70" />
                  <span className="w-3 h-3 rounded-full bg-emerald-400/70" />
                  <span className="ml-2 text-xs font-mono text-slate-600">terminal</span>
                </div>
                <pre className="p-5 text-xs font-mono text-emerald-300 leading-relaxed overflow-x-auto">
                  {step.code}
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Architecture Flow ─────────────────────────────────────────────────────────

const archNodes = [
  { icon: <Bot size={20} />,      label: "AI Agent",     sub: "Any LLM client",     color: "violet" },
  { icon: <Globe size={20} />,    label: "FastAPI",       sub: "HTTP 402 gateway",   color: "blue"   },
  { icon: <CreditCard size={20} />,label: "Stellar",      sub: "x402 micropayment",  color: "cyan"   },
  { icon: <Layers size={20} />,   label: "LangChain",    sub: "RAG orchestration",  color: "violet" },
  { icon: <Database size={20} />, label: "ChromaDB",     sub: "Vector store",       color: "blue"   },
  { icon: <Cpu size={20} />,      label: "Gemini API",   sub: "LLM + embeddings",   color: "cyan"   },
];

const colorMap: Record<string, { bg: string; text: string; border: string }> = {
  violet: { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/30" },
  blue:   { bg: "bg-blue-500/15",   text: "text-blue-400",   border: "border-blue-500/30"   },
  cyan:   { bg: "bg-cyan-500/15",   text: "text-cyan-400",   border: "border-cyan-500/30"   },
};

function ArchitectureFlow() {
  return (
    <section id="architecture" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <Badge variant="blue" className="mb-4">Architecture</Badge>
          <h2 className="section-heading mb-4">
            Full-Stack <span className="gradient-text">System Design</span>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Every component from agent to answer — connected via payments and vectors.
          </p>
        </div>

        {/* Flow diagram */}
        <div className="glass-card gradient-border rounded-3xl p-8 md:p-12">
          <div className="flex flex-col md:flex-row items-center justify-center gap-0">
            {archNodes.map((node, i) => {
              const c = colorMap[node.color];
              return (
                <div key={node.label} className="flex flex-col md:flex-row items-center">
                  {/* Node */}
                  <div className="flex flex-col items-center group">
                    <div
                      className={`w-20 h-20 rounded-2xl border ${c.bg} ${c.border} ${c.text}
                        flex items-center justify-center mb-3
                        transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg`}
                    >
                      {node.icon}
                    </div>
                    <span className="text-sm font-semibold text-white">{node.label}</span>
                    <span className="text-xs text-slate-500 text-center mt-0.5">{node.sub}</span>
                  </div>

                  {/* Arrow connector */}
                  {i < archNodes.length - 1 && (
                    <div className="flex flex-col items-center md:flex-row my-4 md:my-0 md:mx-3">
                      <div className="md:hidden w-px h-8 bg-gradient-to-b from-violet-500 to-blue-500" />
                      <div className="hidden md:flex items-center gap-1">
                        <div className="w-8 h-px bg-gradient-to-r from-violet-500 to-blue-500" />
                        <ChevronRight size={14} className="text-violet-400 -ml-1" />
                      </div>
                      <div className="md:hidden">
                        <ChevronRight size={14} className="text-violet-400 rotate-90" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-10 pt-8 border-t border-white/5 grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: "Frontend",   val: "Next.js 16 + TypeScript + Tailwind", icon: <Globe size={14} /> },
              { label: "Backend",    val: "FastAPI + Python + Pydantic",         icon: <Shield size={14} /> },
              { label: "Payments",   val: "Stellar SDK + x402 protocol",         icon: <CreditCard size={14} /> },
              { label: "Vector DB",  val: "ChromaDB (persistent)",               icon: <Database size={14} /> },
              { label: "LLM",        val: "Gemini 2.0 Flash",                    icon: <Cpu size={14} /> },
              { label: "RAG Chain",  val: "LangChain RetrievalQA",               icon: <Layers size={14} /> },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2.5">
                <span className="text-violet-400 mt-0.5 flex-shrink-0">{item.icon}</span>
                <div>
                  <p className="text-xs font-semibold text-slate-300">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.val}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Features grid ─────────────────────────────────────────────────────────────

const features = [
  {
    icon: <Lock size={22} />,
    title: "Payment-Gated Access",
    desc: "Every API call requires a verified Stellar transaction. No payment = HTTP 402. Zero subscriptions.",
    accent: "violet",
  },
  {
    icon: <BookOpen size={22} />,
    title: "LangChain RAG Pipeline",
    desc: "Documents are chunked, embedded with Gemini, stored in ChromaDB, and retrieved with semantic search.",
    accent: "blue",
  },
  {
    icon: <Bot size={22} />,
    title: "Autonomous Agent Ready",
    desc: "Any AI agent with a Stellar wallet can query the knowledge API autonomously — no human in the loop.",
    accent: "cyan",
  },
  {
    icon: <Zap size={22} />,
    title: "Sub-second Payments",
    desc: "Stellar settles in 3–5 seconds. Agents get access tokens immediately after on-chain confirmation.",
    accent: "violet",
  },
  {
    icon: <Database size={22} />,
    title: "Upload Any Documents",
    desc: "PDFs, text files, web pages — ingest them into your private ChromaDB knowledge base via the admin API.",
    accent: "blue",
  },
  {
    icon: <Shield size={22} />,
    title: "Tamper-Proof Billing",
    desc: "All payments are verified on the Stellar blockchain. Replay attacks are prevented with transaction IDs.",
    accent: "cyan",
  },
];

function Features() {
  return (
    <section id="features" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <Badge variant="green" className="mb-4">Features</Badge>
          <h2 className="section-heading mb-4">
            Everything an <span className="gradient-text">Agentic Economy</span> Needs
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => {
            const c = colorMap[f.accent];
            return (
              <Card key={f.title} hover glow={f.accent as "violet" | "blue" | "cyan"}>
                <div className={`w-12 h-12 rounded-xl ${c.bg} ${c.text} flex items-center justify-center mb-4`}>
                  {f.icon}
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── CTA ───────────────────────────────────────────────────────────────────────

function CTA() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-3xl mx-auto text-center">
        <div className="glass-card gradient-border rounded-3xl p-12 relative overflow-hidden">
          {/* Glow blob */}
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600/10 to-blue-600/10 rounded-3xl" />

          <div className="relative">
            <Badge variant="amber" className="mb-6">
              <span className="pulse-dot amber" />
              Live on Stellar Testnet
            </Badge>

            <h2 className="section-heading mb-4">
              Ready to Build the{" "}
              <span className="gradient-text">Agentic Economy?</span>
            </h2>

            <p className="text-slate-400 mb-8 leading-relaxed">
              Watch a live AI agent pay 0.01 XLM and receive a Gemini-generated answer —
              all in under 10 seconds.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/demo" className="btn-primary text-base px-10 py-3.5 gap-2">
                <Bot size={18} />
                Launch AI Demo
              </Link>
              <Link href="/dashboard" className="btn-secondary text-base px-10 py-3.5">
                View Analytics
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <ArchitectureFlow />
        <Features />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
