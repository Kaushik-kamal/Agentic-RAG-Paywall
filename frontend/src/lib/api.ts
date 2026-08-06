/**
 * Typed client for the Agentic RAG Paywall API.
 *
 * Read-only and paid endpoints are called directly from the browser. Writes to
 * the shared knowledge base go through Next.js route handlers under `/api`,
 * which hold the admin key server-side — it never reaches the client bundle.
 */

import type {
  Analytics,
  ApiErrorBody,
  Atlas,
  AtlasProjection,
  Balance,
  Conversation,
  DocumentLibrary,
  Health,
  IngestResult,
  PaymentChallenge,
  PaymentEntry,
  PlatformStats,
  QueryAnswer,
  RuntimeConfig,
  SearchResult,
  StoredMessage,
  VerifyResult,
} from "./types";

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1"
).replace(/\/$/, "");

export const API_ORIGIN = API_BASE.replace(/\/api\/v\d+$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The paywall's own signals, which callers branch on. */
  get isPaymentRequired(): boolean {
    return this.status === 402;
  }

  get isNetworkFailure(): boolean {
    return this.status === 0;
  }

  /** A 402 body doubles as a payment challenge. */
  get challenge(): PaymentChallenge | null {
    const details = this.details as Partial<PaymentChallenge>;
    return details?.challenge_id && details?.destination
      ? (details as PaymentChallenge)
      : null;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  token?: string;
  /** Absolute or app-relative URL, bypassing API_BASE. */
  absolute?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, token, absolute, headers, ...rest } = options;
  const url = absolute ? path : `${API_BASE}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "Cannot reach the API. Is the backend running on port 8000?",
    );
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? "http_error",
      envelope?.error?.message ?? response.statusText,
      envelope?.error?.details ?? {},
      envelope?.request_id ?? response.headers.get("x-request-id") ?? undefined,
    );
  }

  return payload as T;
}

// ── System ───────────────────────────────────────────────────────────────────

export const getConfig = () => request<RuntimeConfig>("/config");
export const getHealth = () => request<Health>("/health");
export const getStats = () => request<PlatformStats>("/stats");
export const getAnalytics = (days = 14) =>
  request<Analytics>(`/analytics?days=${days}`);

// ── Payments ─────────────────────────────────────────────────────────────────

export const getChallenge = (agentId: string) =>
  request<PaymentChallenge>("/payments/challenge", {
    method: "POST",
    body: { agent_id: agentId },
  });

export const verifyPayment = (input: {
  transaction_hash: string;
  agent_id: string;
  challenge_id?: string;
}) => request<VerifyResult>("/payments/verify", { method: "POST", body: input });

export const getBalance = (agentId: string) =>
  request<Balance>(`/payments/balance/${encodeURIComponent(agentId)}`);

export const getPaymentHistory = (limit = 20) =>
  request<{ payments: PaymentEntry[]; total_payments: number; total_revenue_xlm: number }>(
    `/payments/history?limit=${limit}`,
  );

export const getTreasuryAccount = () =>
  request<{
    status: string;
    network: string;
    configured: boolean;
    public_key: string | null;
    balance_xlm?: number;
    explorer_url: string | null;
    sandbox_mode: boolean;
    detail?: string;
  }>("/payments/account");

// ── Agents ───────────────────────────────────────────────────────────────────

export const mintToken = (agentId: string) =>
  request<{ access_token: string; expires_in: number; credits: number }>(
    `/agents/${encodeURIComponent(agentId)}/token`,
    { method: "POST" },
  );

// ── Knowledge API ────────────────────────────────────────────────────────────

export const askQuestion = (
  input: {
    query: string;
    agent_id: string;
    conversation_id?: string | null;
    document_ids?: string[] | null;
    remember?: boolean;
  },
  token: string,
) => request<QueryAnswer>("/rag/query", { method: "POST", body: input, token });

export const semanticSearch = (input: {
  query: string;
  top_k?: number;
  document_ids?: string[] | null;
}) => request<SearchResult>("/rag/search", { method: "POST", body: input });

export const getPipelineStats = () =>
  request<Record<string, unknown>>("/rag/stats");

export const getAtlas = () => request<Atlas>("/rag/atlas");

export const projectIntoAtlas = (query: string, topK = 6) =>
  request<AtlasProjection>("/rag/atlas/project", {
    method: "POST",
    body: { query, top_k: topK },
  });

// ── Conversations ────────────────────────────────────────────────────────────

export const listConversations = (agentId: string) =>
  request<{ conversations: Conversation[]; total: number }>(
    `/conversations?agent_id=${encodeURIComponent(agentId)}`,
  );

export const getConversation = (conversationId: string) =>
  request<{ conversation: Conversation; messages: StoredMessage[] }>(
    `/conversations/${encodeURIComponent(conversationId)}`,
  );

export const deleteConversation = (conversationId: string, agentId: string) =>
  request<{ deleted: boolean }>(
    `/conversations/${encodeURIComponent(conversationId)}?agent_id=${encodeURIComponent(agentId)}`,
    { method: "DELETE" },
  );

// ── Documents (through the Next.js BFF, which holds the admin key) ───────────

export const listDocuments = () =>
  request<DocumentLibrary>("/api/documents", { absolute: true });

export async function uploadDocument(file: File): Promise<IngestResult> {
  const form = new FormData();
  form.append("file", file);

  let response: Response;
  try {
    response = await fetch("/api/documents", { method: "POST", body: form });
  } catch {
    throw new ApiError(0, "network_error", "Upload failed — the app is unreachable.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? "upload_failed",
      envelope?.error?.message ?? "Upload failed.",
      envelope?.error?.details ?? {},
    );
  }
  return payload as IngestResult;
}

export const deleteDocument = (documentId: string) =>
  request<{ deleted: boolean }>(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    absolute: true,
  });
