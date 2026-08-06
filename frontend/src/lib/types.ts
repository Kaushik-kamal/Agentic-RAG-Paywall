/** Shapes returned by the FastAPI backend. Kept in one place so a schema
 *  change surfaces as a compile error rather than a runtime surprise. */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
  request_id?: string;
}

export interface PaymentChallenge {
  protocol?: string;
  challenge_id: string;
  agent_id?: string;
  destination: string;
  amount_xlm: number;
  asset: string;
  memo: string;
  network: string;
  expires_at: string;
  credits_granted: number;
  sandbox_mode: boolean;
  price_usd: number;
  funding_url?: string | null;
  verify_url?: string;
  instructions?: string;
  reason?: string;
}

export interface VerifyResult {
  verified: boolean;
  access_token: string;
  token_type: string;
  expires_in: number;
  credits_granted: number;
  credits_remaining: number;
  amount_xlm: number;
  mode: "live" | "sandbox";
  transaction_hash: string;
  explorer_url: string | null;
}

export interface Balance {
  agent_id: string;
  credits: number;
  total_queries: number;
  total_spent_xlm: number;
  price_xlm: number;
  credits_per_payment: number;
}

export interface Citation {
  marker: number;
  chunk_id: string;
  document_id: string;
  document_title: string;
  locator: string;
  section: string;
  page: number | null;
  score: number;
  snippet: string;
  used: boolean;
}

export interface Confidence {
  score: number;
  percent: number;
  label: string;
  reasons: string[];
}

export interface RetrievalTrace {
  strategy: string;
  timings_ms?: Record<string, number>;
  dense_candidates: number;
  lexical_candidates: number;
  fused_candidates?: number;
  selected?: number;
  documents_represented?: number;
  corpus_chunks: number;
  min_relevance?: number;
}

export interface RetrievalCandidate {
  chunk_id: string;
  document_id: string;
  document_title: string;
  locator: string;
  page: number | null;
  section: string;
  preview: string;
  dense_rank: number | null;
  dense_score: number;
  lexical_rank: number | null;
  lexical_score: number;
  fused_score: number;
  selected: boolean;
  rejected_reason: string | null;
}

export interface AnswerMetrics {
  chunks_retrieved: number;
  chunks_cited: number;
  top_score: number;
  mean_score: number;
}

export interface QueryAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  sources: string[];
  follow_ups: string[];
  confidence: Confidence;
  retrieval: RetrievalTrace;
  candidates: RetrievalCandidate[];
  latency_ms: number;
  retrieval_ms?: number;
  first_token_ms?: number | null;
  tokens_used: number;
  cost_xlm: number;
  model: string;
  metrics: AnswerMetrics;
  credits_remaining: number;
  conversation_id: string | null;
}

export interface SearchMatch {
  chunk_id: string;
  document_id: string;
  document_title: string;
  locator: string;
  page: number | null;
  section: string;
  score: number;
  text: string;
}

export interface SearchResult {
  query: string;
  matches: SearchMatch[];
  retrieval: RetrievalTrace;
  latency_ms: number;
}

export interface KnowledgeDocument {
  document_id: string;
  filename: string;
  title: string;
  media_type: string;
  size_bytes: number;
  chunk_count: number;
  char_count: number;
  page_count: number | null;
  summary: string | null;
  topics: string[];
  status: string;
  created_at: string;
}

export interface DocumentLibrary {
  documents: KnowledgeDocument[];
  total_documents: number;
  total_chunks: number;
  total_characters: number;
  supported_extensions: string[];
  max_upload_mb: number;
}

export interface IngestResult {
  document: KnowledgeDocument;
  chunks_indexed: number;
  duplicate: boolean;
  elapsed_ms: number;
  message: string;
}

export interface PlatformStats {
  total_documents: number;
  total_chunks: number;
  total_characters: number;
  total_queries: number;
  avg_latency_ms: number;
  avg_confidence: number;
  total_tokens: number;
  failed_queries: number;
  success_rate: number;
  total_payments: number;
  total_revenue_xlm: number;
  total_credits_sold: number;
  total_agents: number;
  outstanding_credits: number;
  indexed_vectors: number;
  price_xlm: number;
  price_usd: number;
  revenue_usd: number;
  network: string;
  model: string;
}

export interface DaySeries {
  day: string;
  queries: number;
  avg_latency_ms: number;
  revenue_xlm: number;
}

export interface QueryLogEntry {
  query_id: string;
  agent_id: string;
  question: string;
  answer_preview: string | null;
  confidence: number | null;
  latency_ms: number | null;
  tokens_used: number | null;
  chunks_used: number | null;
  status: string;
  created_at: string;
}

export interface PaymentEntry {
  payment_id: string;
  agent_id: string;
  tx_hash: string;
  amount_xlm: number;
  credits_granted: number;
  network: string;
  mode: "live" | "sandbox";
  created_at: string;
  explorer_url?: string | null;
}

export interface Analytics {
  queries_by_day: DaySeries[];
  revenue_by_day: { day: string; revenue_xlm: number; payments: number }[];
  recent_queries: QueryLogEntry[];
  recent_payments: PaymentEntry[];
  top_questions: { question: string; occurrences: number; avg_confidence: number | null }[];
  totals: Partial<PlatformStats>;
  pipeline: Record<string, unknown>;
  cache: Record<string, number>;
}

export interface HealthComponent {
  status: string;
  [key: string]: unknown;
}

export interface Health {
  status: "ok" | "degraded";
  service: string;
  version: string;
  environment: string;
  uptime_seconds: number;
  components: Record<string, HealthComponent>;
  degraded: string[];
}

export interface RuntimeConfig {
  app_name: string;
  version: string;
  environment: string;
  pricing: {
    price_xlm: number;
    price_usd: number;
    credits_per_payment: number;
    price_per_credit_xlm: number;
    free_credits_on_signup: number;
    asset: string;
    network: string;
    sandbox_mode: boolean;
    settlement_seconds: number;
  };
  models: { generation: string; embedding: string; configured: boolean };
  retrieval: {
    strategy: string;
    top_k: number;
    fetch_k: number;
    chunk_size: number;
    chunk_overlap: number;
  };
  uploads: { max_mb: number; extensions: string[] };
  stellar: {
    network: string;
    explorer: string;
    configured: boolean;
    sandbox_mode: boolean;
  };
}

export interface Conversation {
  conversation_id: string;
  agent_id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  message_id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  metrics: Record<string, unknown>;
  created_at: string;
}
