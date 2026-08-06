/** SSE client for `POST /marketplace/route` — the autonomous discovery loop. */

import { API_BASE, ApiError } from "./api";
import type {
  Citation,
  Confidence,
  Objective,
  Reputation,
  RouteCandidate,
  ProviderStats,
} from "./types";

export interface RouteHandlers {
  onIntent?: (p: { query: string; objective: Objective; message: string }) => void;
  onDiscovered?: (p: {
    considered: number;
    providers: RouteCandidate[];
    message: string;
  }) => void;
  onRanked?: (p: {
    shortlisted: number;
    weights: Record<string, number>;
    objective_label: string;
    decided_in_ms: number;
    message: string;
  }) => void;
  onSelected?: (p: {
    decision_id: string;
    provider: RouteCandidate;
    runner_up: RouteCandidate | null;
    rationale: string;
    tradeoffs: string[];
  }) => void;
  onPayment?: (p: {
    stage: "authorising" | "settled";
    provider: string;
    price_xlm: number;
    credits: number;
    credits_remaining?: number;
    message: string;
  }) => void;
  onInvoking?: (p: {
    provider: string;
    endpoint: string;
    model: string;
    scope_documents: number;
    message: string;
  }) => void;
  onRetrieval?: (p: { citations: Citation[]; retrieval_ms: number }) => void;
  onToken?: (text: string) => void;
  onFollowUps?: (questions: string[]) => void;
  onDone?: (p: RouteDone) => void;
  onError?: (error: ApiError) => void;
}

export interface RouteDone {
  decision_id: string;
  answer: string;
  citations: Citation[];
  follow_ups: string[];
  confidence: Confidence;
  metrics: { chunks_retrieved: number; chunks_cited: number; top_score: number };
  provider: {
    provider_id: string;
    slug: string;
    name: string;
    accent: string;
    category: string;
  };
  reputation_after: Reputation;
  stats_after: ProviderStats;
  price_xlm: number;
  credits_charged: number;
  credits_remaining: number;
  invocation_ms: number;
  total_ms: number;
  routing_ms: number;
}

function* frames(buffer: string): Generator<{ event: string; data: string }> {
  for (const block of buffer.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length) yield { event, data: data.join("\n") };
  }
}

export async function routeRequest(
  input: { query: string; agent_id: string; objective: Objective },
  token: string,
  handlers: RouteHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/marketplace/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return;
    handlers.onError?.(
      new ApiError(0, "network_error", "Cannot reach the discovery network."),
    );
    return;
  }

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    handlers.onError?.(
      new ApiError(
        response.status,
        payload?.error?.code ?? "http_error",
        payload?.error?.message ?? response.statusText,
        payload?.error?.details ?? {},
      ),
    );
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;

      const boundary = buffer.lastIndexOf("\n\n");
      if (boundary === -1) continue;
      const complete = buffer.slice(0, boundary + 2);
      buffer = buffer.slice(boundary + 2);
      for (const frame of frames(complete)) dispatch(frame, handlers);
    }
    for (const frame of frames(buffer)) dispatch(frame, handlers);
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      handlers.onError?.(
        new ApiError(0, "stream_interrupted", "The routing stream was interrupted."),
      );
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatch(
  frame: { event: string; data: string },
  handlers: RouteHandlers,
): void {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return;
  }

  switch (frame.event) {
    case "intent":
      handlers.onIntent?.(payload as never);
      break;
    case "discovered":
      handlers.onDiscovered?.(payload as never);
      break;
    case "ranked":
      handlers.onRanked?.(payload as never);
      break;
    case "selected":
      handlers.onSelected?.(payload as never);
      break;
    case "payment":
      handlers.onPayment?.(payload as never);
      break;
    case "invoking":
      handlers.onInvoking?.(payload as never);
      break;
    case "retrieval":
      handlers.onRetrieval?.(payload as never);
      break;
    case "token":
      handlers.onToken?.((payload as { text: string }).text);
      break;
    case "follow_ups":
      handlers.onFollowUps?.((payload as { questions: string[] }).questions);
      break;
    case "done":
      handlers.onDone?.(payload as unknown as RouteDone);
      break;
    case "error":
      handlers.onError?.(
        new ApiError(
          400,
          String(payload.code ?? "error"),
          String(payload.message ?? "Routing failed."),
          (payload.details as Record<string, unknown>) ?? {},
        ),
      );
      break;
  }
}
