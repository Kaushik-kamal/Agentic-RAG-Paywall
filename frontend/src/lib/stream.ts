/** Server-Sent Events client for `POST /rag/stream`.
 *
 * `EventSource` cannot issue a POST or set an Authorization header, so we read
 * the body stream ourselves and parse the SSE framing.
 */

import { API_BASE, ApiError } from "./api";
import type {
  Citation,
  Confidence,
  RetrievalCandidate,
  RetrievalTrace,
  AnswerMetrics,
} from "./types";

export interface StreamStart {
  agent_id: string;
  conversation_id: string | null;
  credits_remaining: number;
  cost_xlm: number;
  model: string;
}

export interface StreamRetrieval {
  citations: Citation[];
  trace: RetrievalTrace;
  candidates: RetrievalCandidate[];
  retrieval_ms: number;
}

export interface StreamDone {
  answer: string;
  citations: Citation[];
  sources: string[];
  follow_ups: string[];
  confidence: Confidence;
  latency_ms: number;
  retrieval_ms: number;
  first_token_ms: number | null;
  tokens_used: number;
  cost_xlm: number;
  model: string;
  metrics: AnswerMetrics;
  credits_remaining: number;
}

export interface StreamHandlers {
  onStart?: (payload: StreamStart) => void;
  onStatus?: (payload: { stage: string; message: string }) => void;
  onRetrieval?: (payload: StreamRetrieval) => void;
  onToken?: (text: string) => void;
  onFollowUps?: (questions: string[]) => void;
  onDone?: (payload: StreamDone) => void;
  onError?: (error: ApiError) => void;
}

export interface StreamRequest {
  query: string;
  agent_id: string;
  conversation_id?: string | null;
  document_ids?: string[] | null;
  remember?: boolean;
}

/** Splits an SSE buffer into complete `event:`/`data:` frames. */
function* parseFrames(buffer: string): Generator<{ event: string; data: string }> {
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

export async function streamAnswer(
  input: StreamRequest,
  token: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/rag/stream`, {
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
      new ApiError(0, "network_error", "Cannot reach the API. Is the backend running?"),
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
        payload?.request_id,
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

      // Keep the trailing partial frame in the buffer until it completes.
      const boundary = buffer.lastIndexOf("\n\n");
      if (boundary === -1) continue;
      const complete = buffer.slice(0, boundary + 2);
      buffer = buffer.slice(boundary + 2);

      for (const frame of parseFrames(complete)) {
        dispatch(frame, handlers);
      }
    }
    for (const frame of parseFrames(buffer)) dispatch(frame, handlers);
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      handlers.onError?.(
        new ApiError(0, "stream_interrupted", "The answer stream was interrupted."),
      );
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatch(
  frame: { event: string; data: string },
  handlers: StreamHandlers,
): void {
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return; // ignore malformed frames rather than killing the stream
  }

  switch (frame.event) {
    case "start":
      handlers.onStart?.(payload as StreamStart);
      break;
    case "status":
      handlers.onStatus?.(payload as { stage: string; message: string });
      break;
    case "retrieval":
      handlers.onRetrieval?.(payload as StreamRetrieval);
      break;
    case "token":
      handlers.onToken?.((payload as { text: string }).text);
      break;
    case "follow_ups":
      handlers.onFollowUps?.((payload as { questions: string[] }).questions);
      break;
    case "done":
      handlers.onDone?.(payload as StreamDone);
      break;
    case "error": {
      const error = payload as {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
      handlers.onError?.(
        new ApiError(400, error.code, error.message, error.details ?? {}),
      );
      break;
    }
  }
}
