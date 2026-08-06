"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowUp,
  Coins,
  CornerDownLeft,
  Download,
  History,
  Loader2,
  MessageSquarePlus,
  Radar,
  Square,
  Trash2,
  Zap,
} from "lucide-react";

import { AnswerBody } from "./AnswerBody";
import { CitationRail } from "./CitationRail";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { PaywallDialog } from "./PaywallDialog";
import { RetrievalTrace } from "./RetrievalTrace";

import { useSession } from "@/components/providers/SessionProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { Badge, Chip, Kbd, LiveDot } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CodeBlock";
import { EmptyState, OfflineBanner, Spinner } from "@/components/ui/Feedback";
import { ApiError, deleteConversation, getConversation, listConversations } from "@/lib/api";
import { streamAnswer } from "@/lib/stream";
import type {
  CacheInfo,
  Citation,
  Confidence,
  Conversation,
  RetrievalCandidate,
  RetrievalTrace as Trace,
} from "@/lib/types";
import { cn, formatDuration, formatRelative, truncate } from "@/lib/utils";

interface Turn {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  candidates: RetrievalCandidate[];
  trace: Trace | null;
  confidence: Confidence | null;
  followUps: string[];
  status: "retrieving" | "generating" | "done" | "error";
  statusMessage: string;
  latencyMs?: number;
  retrievalMs?: number;
  firstTokenMs?: number | null;
  tokensUsed?: number;
  costXlm?: number;
  model?: string;
  error?: string;
  cache?: CacheInfo | null;
}

const STARTERS = [
  "How does Reciprocal Rank Fusion combine dense and lexical search?",
  "Why does the x402 memo matter?",
  "What makes Stellar suitable for micropayments?",
  "Why is a session token wrong for a pay-per-query API?",
];

function newTurn(question: string): Turn {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    question,
    answer: "",
    citations: [],
    candidates: [],
    trace: null,
    confidence: null,
    followUps: [],
    status: "retrieving",
    statusMessage: "Searching the knowledge base",
  };
}

export function ConsoleWorkspace() {
  const params = useSearchParams();
  const { agentId, credits, config, offline, ready, getToken, refresh, setCredits } =
    useSession();
  const { toast } = useToast();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeMarker, setActiveMarker] = useState<number | null>(null);
  const [inspector, setInspector] = useState<"sources" | "retrieval">("sources");
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallReason, setPaywallReason] = useState<string>();
  const [streaming, setStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const askRef = useRef<(question: string) => void>(() => {});
  const seededRef = useRef(false);

  const latest = turns.at(-1) ?? null;

  // ── Conversation list ──────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    if (!agentId) return;
    try {
      const result = await listConversations(agentId);
      setConversations(result.conversations);
    } catch {
      /* history is a convenience; failure is not worth interrupting for */
    }
  }, [agentId]);

  useEffect(() => {
    // Every state update inside loadConversations happens after an await; the
    // rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready) void loadConversations();
  }, [ready, loadConversations]);

  // ── Ask ────────────────────────────────────────────────────────────────────
  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || streaming || !agentId) return;

      if (credits <= 0) {
        setPaywallReason(
          "Your credit balance is empty. One x402 payment buys another bundle of answers.",
        );
        setPaywallOpen(true);
        return;
      }

      const turn = newTurn(trimmed);
      setTurns((current) => [...current, turn]);
      setDraft("");
      setStreaming(true);
      setActiveMarker(null);
      setInspector("sources");

      const patch = (changes: Partial<Turn>) =>
        setTurns((current) =>
          current.map((item) => (item.id === turn.id ? { ...item, ...changes } : item)),
        );

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = await getToken();
        await streamAnswer(
          {
            query: trimmed,
            agent_id: agentId,
            conversation_id: conversationId,
            remember: true,
          },
          token,
          {
            onStart: (payload) => {
              if (payload.conversation_id) setConversationId(payload.conversation_id);
              setCredits(payload.credits_remaining);
            },
            onStatus: (payload) =>
              patch({
                status: payload.stage === "generating" ? "generating" : "retrieving",
                statusMessage: payload.message,
              }),
            onRetrieval: (payload) =>
              patch({
                citations: payload.citations,
                candidates: payload.candidates,
                trace: payload.trace,
                retrievalMs: payload.retrieval_ms,
              }),
            onToken: (text) =>
              setTurns((current) =>
                current.map((item) =>
                  item.id === turn.id
                    ? { ...item, answer: item.answer + text, status: "generating" }
                    : item,
                ),
              ),
            onFollowUps: (questions) => patch({ followUps: questions }),
            onDone: (payload) => {
              patch({
                status: "done",
                answer: payload.answer,
                citations: payload.citations,
                confidence: payload.confidence,
                followUps: payload.follow_ups,
                latencyMs: payload.latency_ms,
                retrievalMs: payload.retrieval_ms,
                firstTokenMs: payload.first_token_ms,
                tokensUsed: payload.tokens_used,
                costXlm: payload.cost_xlm,
                model: payload.model,
                cache: payload.cached ? payload.cache : null,
              });
              setCredits(payload.credits_remaining);
              loadConversations();
            },
            onError: (error) => {
              patch({ status: "error", error: error.message });
              if (error.isPaymentRequired) {
                setPaywallReason(error.message);
                setPaywallOpen(true);
              } else {
                toast({
                  tone: "error",
                  title: "Query failed",
                  description: error.message,
                });
              }
              refresh();
            },
          },
          controller.signal,
        );
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : "Something went wrong.";
        patch({ status: "error", error: message });
        toast({ tone: "error", title: "Query failed", description: message });
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [
      agentId,
      conversationId,
      credits,
      getToken,
      loadConversations,
      refresh,
      setCredits,
      streaming,
      toast,
    ],
  );

  useEffect(() => {
    askRef.current = ask;
  }, [ask]);

  // A query can arrive from the command palette as ?q=… Deferring by a tick
  // keeps the request out of the mount render.
  useEffect(() => {
    const seeded = params.get("q");
    if (!seeded || !ready || credits <= 0 || seededRef.current) return;
    seededRef.current = true;
    const timer = setTimeout(() => void askRef.current(seeded), 0);
    return () => clearTimeout(timer);
  }, [params, ready, credits]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns.length, latest?.answer]);

  const startNew = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setConversationId(null);
    setActiveMarker(null);
    setDraft("");
    inputRef.current?.focus();
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        startNew();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startNew]);

  const openConversation = useCallback(
    async (id: string) => {
      try {
        const { conversation, messages } = await getConversation(id);
        const restored: Turn[] = [];
        for (let index = 0; index < messages.length; index += 1) {
          const message = messages[index];
          if (message.role !== "user") continue;
          const reply = messages[index + 1];
          const metrics = (reply?.metrics ?? {}) as Record<string, unknown>;
          restored.push({
            id: message.message_id,
            question: message.content,
            answer: reply?.content ?? "",
            citations: reply?.citations ?? [],
            candidates: [],
            trace: null,
            confidence: (metrics.confidence as Confidence) ?? null,
            followUps: (metrics.follow_ups as string[]) ?? [],
            status: "done",
            statusMessage: "",
            latencyMs: metrics.latency_ms as number | undefined,
            model: metrics.model as string | undefined,
          });
        }
        setTurns(restored);
        setConversationId(conversation.conversation_id);
        setHistoryOpen(false);
      } catch {
        toast({ tone: "error", title: "Could not load that conversation" });
      }
    },
    [toast],
  );

  const removeConversation = useCallback(
    async (id: string) => {
      if (!agentId) return;
      try {
        await deleteConversation(id, agentId);
        setConversations((current) =>
          current.filter((item) => item.conversation_id !== id),
        );
        if (conversationId === id) startNew();
      } catch {
        toast({ tone: "error", title: "Could not delete that conversation" });
      }
    },
    [agentId, conversationId, startNew, toast],
  );

  const exportMarkdown = useCallback(() => {
    if (!turns.length) return;
    const body = turns
      .map((turn) => {
        const sources = turn.citations
          .filter((citation) => citation.used)
          .map((citation) => `- [${citation.marker}] ${citation.locator}`)
          .join("\n");
        return [
          `## ${turn.question}`,
          "",
          turn.answer,
          "",
          turn.confidence
            ? `**Confidence:** ${turn.confidence.percent}% (${turn.confidence.label})`
            : "",
          sources ? `\n**Sources**\n${sources}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n---\n\n");

    const blob = new Blob(
      [`# Agentic RAG Paywall — session transcript\n\n${body}\n`],
      { type: "text/markdown" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `argp-session-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
    toast({ tone: "success", title: "Transcript exported" });
  }, [turns, toast]);

  return (
    <div className="shell py-6">
      <PaywallDialog
        open={paywallOpen}
        reason={paywallReason}
        onClose={() => setPaywallOpen(false)}
      />

      {offline ? <OfflineBanner className="mb-4" /> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ── Conversation ───────────────────────────────────────────────── */}
        {/* Fixed to the viewport so the message list is the only thing that
            scrolls — a chat surface that also scrolls the page feels broken. */}
        <section className="panel flex h-[calc(100dvh-var(--nav-height)-3rem)] flex-col overflow-hidden">
          <header className="flex items-center gap-2 border-b border-[color:var(--line)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 text-sm font-semibold">
                Knowledge console
                {streaming ? (
                  <span className="flex items-center gap-1.5 text-xs font-normal text-[var(--accent-strong)]">
                    <LiveDot tone="accent" />
                    {latest?.statusMessage}
                  </span>
                ) : null}
              </h1>
              <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                {config?.models.generation ?? "Gemini"} ·{" "}
                {config?.retrieval.strategy ?? "hybrid"} retrieval ·{" "}
                {credits} credit{credits === 1 ? "" : "s"} left
              </p>
            </div>

            <IconButton
              label="Conversation history"
              className="demo-quiet"
              onClick={() => setHistoryOpen((value) => !value)}
              icon={<History size={16} />}
            />
            <IconButton
              label="Export transcript"
              onClick={exportMarkdown}
              disabled={!turns.length}
              icon={<Download size={16} />}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={startNew}
              icon={<MessageSquarePlus size={14} />}
            >
              New
            </Button>
          </header>

          {historyOpen ? (
            <div className="animate-fade max-h-56 overflow-y-auto border-b border-[color:var(--line)] bg-[var(--surface-raised)] p-2">
              {conversations.length ? (
                <ul className="space-y-1">
                  {conversations.map((conversation) => (
                    <li key={conversation.conversation_id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openConversation(conversation.conversation_id)}
                        className={cn(
                          "min-w-0 flex-1 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]",
                          conversationId === conversation.conversation_id &&
                            "bg-[var(--accent-soft)]",
                        )}
                      >
                        <span className="block truncate text-xs text-[var(--text)]">
                          {conversation.title}
                        </span>
                        <span className="block text-[0.6875rem] text-[var(--text-faint)]">
                          {conversation.message_count} messages ·{" "}
                          {formatRelative(conversation.updated_at)}
                        </span>
                      </button>
                      <IconButton
                        label="Delete conversation"
                        onClick={() => removeConversation(conversation.conversation_id)}
                        icon={<Trash2 size={13} />}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-2 py-4 text-center text-xs text-[var(--text-muted)]">
                  No saved conversations yet.
                </p>
              )}
            </div>
          ) : null}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
            {turns.length === 0 ? (
              <EmptyState
                icon={<Radar size={22} />}
                title="Ask the knowledge base anything"
                description="Answers are generated only from indexed documents, with a citation on every claim and a confidence score you can inspect."
                action={
                  <div className="flex max-w-lg flex-wrap justify-center gap-2">
                    {STARTERS.map((starter) => (
                      <Chip key={starter} onClick={() => ask(starter)}>
                        {truncate(starter, 46)}
                      </Chip>
                    ))}
                  </div>
                }
              />
            ) : (
              <ol className="space-y-8">
                {turns.map((turn) => (
                  <li key={turn.id} className="animate-rise space-y-3">
                    <div className="flex justify-end">
                      <p className="max-w-[85%] rounded-[var(--radius-lg)] rounded-br-sm bg-[var(--accent-soft)] px-4 py-2.5 text-sm text-[var(--text)]">
                        {turn.question}
                      </p>
                    </div>

                    {turn.status === "retrieving" && !turn.answer ? (
                      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                        <Spinner size={14} />
                        {turn.statusMessage}
                      </div>
                    ) : null}

                    {turn.status === "error" ? (
                      <div className="rounded-[var(--radius)] border border-[color:var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                        {turn.error}
                      </div>
                    ) : null}

                    {turn.answer || turn.status === "generating" ? (
                      <div className="space-y-3">
                        <AnswerBody
                          content={turn.answer}
                          streaming={turn.status === "generating"}
                          activeMarker={activeMarker}
                          availableMarkers={turn.citations.map((c) => c.marker)}
                          onCite={(marker) => {
                            setActiveMarker(marker);
                            setInspector("sources");
                          }}
                        />

                        {turn.status === "done" ? (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.6875rem] text-[var(--text-faint)]">
                            {turn.confidence ? (
                              <ConfidenceMeter confidence={turn.confidence} compact />
                            ) : null}
                            <span>{formatDuration(turn.latencyMs)}</span>
                            {turn.firstTokenMs ? (
                              <span>first token {formatDuration(turn.firstTokenMs)}</span>
                            ) : null}
                            <span>{turn.tokensUsed?.toLocaleString()} tokens</span>
                            {turn.cache ? (
                              <span
                                className="inline-flex items-center gap-1 text-[var(--positive)]"
                                title={`Matched "${turn.cache.matched_question}" at ${Math.round(
                                  turn.cache.similarity * 100,
                                )}% similarity`}
                              >
                                <Zap size={10} />
                                cached · 0 credits
                              </span>
                            ) : (
                              <span className="text-[var(--value)]">
                                {turn.costXlm} XLM
                              </span>
                            )}
                            <CopyButton value={turn.answer} label="Copy" />
                          </div>
                        ) : null}

                        {turn.followUps.length ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {turn.followUps.map((question) => (
                              <Chip
                                key={question}
                                onClick={() => ask(question)}
                                className="max-w-full"
                              >
                                <span className="truncate">{question}</span>
                              </Chip>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* ── Composer ──────────────────────────────────────────────────── */}
          <div className="border-t border-[color:var(--line)] p-3">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={draft}
                rows={1}
                onChange={(event) => {
                  setDraft(event.target.value);
                  event.target.style.height = "auto";
                  event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    ask(draft);
                  }
                }}
                placeholder={
                  credits > 0
                    ? "Ask a question about the indexed documents…"
                    : "Out of credits — settle an x402 payment to continue"
                }
                aria-label="Your question"
                className="field resize-none pr-24"
                style={{ minHeight: "3rem" }}
                disabled={streaming || !ready}
              />

              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                {streaming ? (
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
                    disabled={!draft.trim() || !ready}
                    onClick={() => ask(draft)}
                    icon={
                      streaming ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <ArrowUp size={13} />
                      )
                    }
                  >
                    Ask
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[0.6875rem] text-[var(--text-faint)]">
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Kbd>↵</Kbd> send
                </span>
                <span className="hidden items-center gap-1 sm:flex">
                  <Kbd>⇧↵</Kbd> newline
                </span>
                <span className="hidden items-center gap-1 sm:flex">
                  <Kbd>/</Kbd> focus
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setPaywallReason(undefined);
                  setPaywallOpen(true);
                }}
                className="flex items-center gap-1.5 text-[var(--value)] hover:underline"
              >
                <Coins size={11} />
                {credits} credits · top up
              </button>
            </div>
          </div>
        </section>

        {/* ── Inspector ──────────────────────────────────────────────────── */}
        <aside className="panel flex h-[calc(100dvh-var(--nav-height)-3rem)] flex-col overflow-hidden lg:sticky lg:top-[calc(var(--nav-height)+1.5rem)]">
          <div className="flex border-b border-[color:var(--line)]">
            {(["sources", "retrieval"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setInspector(tab)}
                className={cn(
                  "flex-1 border-b-2 px-3 py-2.5 text-xs font-medium capitalize transition-colors",
                  inspector === tab
                    ? "border-[color:var(--accent)] text-[var(--text)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
                )}
              >
                {tab === "sources" ? "Sources" : "Retrieval"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {!latest ? (
              <p className="px-2 py-8 text-center text-xs leading-relaxed text-[var(--text-muted)]">
                Sources and the full retrieval trace appear here once you ask a
                question.
              </p>
            ) : inspector === "sources" ? (
              <div className="space-y-4">
                {latest.confidence ? (
                  <ConfidenceMeter confidence={latest.confidence} />
                ) : null}
                <CitationRail
                  citations={latest.citations}
                  activeMarker={activeMarker}
                  onSelect={setActiveMarker}
                />
                {!latest.citations.length ? (
                  <p className="px-2 py-6 text-center text-xs text-[var(--text-muted)]">
                    Retrieving passages…
                  </p>
                ) : null}
              </div>
            ) : latest.trace ? (
              <RetrievalTrace
                trace={latest.trace}
                candidates={latest.candidates}
                retrievalMs={latest.retrievalMs}
              />
            ) : (
              <p className="px-2 py-8 text-center text-xs text-[var(--text-muted)]">
                The retrieval trace is captured live during a query. Restored
                conversations do not replay it.
              </p>
            )}
          </div>

          {latest?.model ? (
            <footer className="border-t border-[color:var(--line)] px-3 py-2">
              <Badge tone="neutral" className="w-full justify-center">
                <CornerDownLeft size={10} />
                {latest.model}
              </Badge>
            </footer>
          ) : null}
        </aside>
      </div>

      <p className="mt-4 text-center text-xs text-[var(--text-faint)]">
        Answers are generated only from indexed documents. Uncited claims and a low
        confidence score are signals to verify against the source.
      </p>
    </div>
  );
}
