/**
 * Centralised API client — talks to the FastAPI backend.
 * Base URL is read from the NEXT_PUBLIC_API_URL env var (falls back to localhost).
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

// ── Generic fetch helper ──────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.detail ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function getHealth() {
  const url = BASE_URL.replace("/api/v1", "");
  const res = await fetch(`${url}/health`);
  return res.json() as Promise<{ status: string; service: string; version: string }>;
}

// ── Global stats ──────────────────────────────────────────────────────────────

export interface GlobalStats {
  total_queries: number;
  total_documents: number;
  total_payments: number;
  revenue_xlm: number;
  price_xlm: number;
  network: string;
  model: string;
}

export async function getGlobalStats(): Promise<GlobalStats> {
  return apiFetch<GlobalStats>("/stats");
}

// ── RAG ───────────────────────────────────────────────────────────────────────

export interface QueryRequest {
  query: string;
  agent_id: string;
  payment_token?: string;
}

export interface QueryResponse {
  answer: string;
  sources: string[];
  tokens_used: number;
  cost_xlm: number;
  latency_s?: number;
}

export async function queryRAG(
  body: QueryRequest,
  accessToken: string
): Promise<QueryResponse> {
  return apiFetch<QueryResponse>("/rag/query", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getRAGStats() {
  return apiFetch<{
    total_queries: number;
    total_documents: number;
    collection: string;
    model: string;
  }>("/rag/stats");
}

// ── Payments ──────────────────────────────────────────────────────────────────

export interface PaymentPrice {
  price_xlm: number;
  price_usd_approx: number;
  currency: string;
  network: string;
}

export async function getQueryPrice(): Promise<PaymentPrice> {
  return apiFetch<PaymentPrice>("/payments/price");
}

export interface PaymentChallenge {
  destination: string;
  amount_xlm: number;
  asset: string;
  network: string;
  memo: string;
  expires_at: string;
}

export async function getPaymentChallenge(agentId: string): Promise<PaymentChallenge> {
  return apiFetch<PaymentChallenge>("/payments/challenge", {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId }),
  });
}

export interface VerifyPaymentResponse {
  verified: boolean;
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  reason?: string;
}

export async function verifyPayment(body: {
  transaction_hash: string;
  agent_id: string;
}): Promise<VerifyPaymentResponse> {
  return apiFetch<VerifyPaymentResponse>("/payments/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getPaymentStats() {
  return apiFetch<{
    total_payments: number;
    total_revenue_xlm: number;
    price_per_query_xlm: number;
    network: string;
  }>("/payments/stats");
}

// ── Agents ────────────────────────────────────────────────────────────────────

export interface AgentRegistration {
  name: string;
  description?: string;
  stellar_address: string;
  webhook_url?: string;
}

export interface Agent {
  agent_id: string;
  name: string;
  stellar_address: string;
  created_at: string;
  status: string;
}

export async function registerAgent(body: AgentRegistration): Promise<Agent> {
  return apiFetch<Agent>("/agents/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getAgent(agentId: string): Promise<Agent> {
  return apiFetch<Agent>(`/agents/${agentId}`);
}

export async function getAgentUsage(agentId: string) {
  return apiFetch<{ agent_id: string; query_count: number; xlm_spent: number }>(
    `/agents/${agentId}/usage`
  );
}

export async function listAgents() {
  return apiFetch<{ agents: Agent[]; total: number }>("/agents/");
}
