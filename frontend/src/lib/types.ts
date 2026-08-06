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

// ── Agent Discovery Network ──────────────────────────────────────────────────

export type Objective = "balanced" | "cheapest" | "fastest" | "quality";

export interface ProviderStats {
  total_requests: number;
  successful: number;
  failed: number;
  reliability: number | null;
  avg_latency_ms: number | null;
  revenue_xlm: number;
  avg_confidence: number | null;
}

export interface Reputation {
  trust: number;
  grade: string;
  components: {
    reliability: number;
    quality: number;
    speed: number;
    experience: number;
  };
  weights: Record<string, number>;
  observations: number;
  unproven: boolean;
}

export interface Provider {
  provider_id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  endpoint: string;
  capabilities: string[];
  keywords: string[];
  scope_documents: string[];
  model: string;
  price_xlm: number;
  price_usd: number;
  credits_per_call: number;
  target_latency_ms: number;
  top_k: number;
  temperature: number;
  accent: string;
  status: "online" | "offline" | "degraded";
  registered_by: string | null;
  created_at: string;
  stats: ProviderStats;
  reputation: Reputation;
}

export interface ProviderDetail extends Provider {
  reputation_history: { n: number; trust: number; reliability: number; at: string }[];
  recent_events: {
    event_id: number;
    query: string;
    status: string;
    latency_ms: number | null;
    cost_xlm: number;
    confidence: number | null;
    created_at: string;
  }[];
}

export interface CandidateScores {
  capability: number;
  semantic: number;
  keyword: number;
  trust: number;
  price: number;
  latency: number;
  total: number;
}

export interface RouteCandidate {
  provider_id: string;
  slug: string;
  name: string;
  tagline: string;
  category: string;
  accent: string;
  price_xlm: number;
  credits_per_call: number;
  target_latency_ms: number;
  status: string;
  stats: ProviderStats;
  reputation: Reputation;
  scores: CandidateScores;
  matched_keywords: string[];
  eligible: boolean;
  reason: string | null;
}

export interface RoutingDecision {
  decision_id: string;
  query: string;
  objective: Objective;
  objective_label: string;
  weights: Record<string, number>;
  considered: number;
  shortlisted: number;
  decided_in_ms: number;
  chosen: RouteCandidate | null;
  runner_up: RouteCandidate | null;
  rationale: string;
  tradeoffs: string[];
  candidates: RouteCandidate[];
}

export interface LeaderboardEntry {
  slug: string;
  name: string;
  accent: string;
  value: number;
}

export interface NetworkStats {
  providers_total: number;
  providers_online: number;
  categories: string[];
  total_requests: number;
  successful: number;
  failed: number;
  success_rate: number | null;
  revenue_xlm: number;
  avg_latency_ms: number | null;
  avg_price_xlm: number;
  cheapest_xlm: number;
  dearest_xlm: number;
  leaderboard: {
    most_trusted: LeaderboardEntry | null;
    most_used: LeaderboardEntry | null;
    cheapest: LeaderboardEntry | null;
    fastest: LeaderboardEntry | null;
    highest_revenue: LeaderboardEntry | null;
  };
  activity: { hour: string; requests: number; revenue_xlm: number }[];
  recent_events: {
    event_id: number;
    provider_name: string;
    provider_slug: string;
    provider_accent: string;
    query: string;
    status: string;
    latency_ms: number | null;
    cost_xlm: number;
    confidence: number | null;
    created_at: string;
  }[];
  recent_decisions: {
    decision_id: string;
    query: string;
    objective: string;
    considered: number;
    shortlisted: number;
    chosen_name: string | null;
    chosen_slug: string | null;
    chosen_accent: string | null;
    rationale: string | null;
    decided_in_ms: number;
    created_at: string;
  }[];
}

export interface ComparisonResult {
  slug: string;
  name: string;
  accent: string;
  category: string;
  status: "answered" | "refused" | "failed";
  answer?: string;
  citations?: Citation[];
  confidence?: Confidence;
  latency_ms?: number;
  price_xlm: number;
  credits_charged?: number;
  cited?: number;
  retrieved?: number;
  top_score?: number;
  value_score?: number;
  overall?: number;
  error?: string;
}

export interface Comparison {
  query: string;
  results: ComparisonResult[];
  ranked: string[];
  winner: string | null;
  router_would_choose: string | null;
  router_rationale: string;
  agreement: boolean;
  elapsed_ms: number;
}

export interface CacheInfo {
  hit: boolean;
  matched_question: string;
  similarity: number;
  age_seconds: number;
  credits_charged: number;
}

export interface AtlasPoint {
  chunk_id: string;
  document_id: string;
  document_title: string;
  section: string;
  page: number | null;
  preview: string;
  x: number;
  y: number;
}

export interface Atlas {
  available: boolean;
  reason?: string;
  points: AtlasPoint[];
  documents: { document_id: string; title: string; chunks: number }[];
  explained_variance: number[];
  total_variance_explained?: number;
  dimensions?: number;
  method?: string;
  revision?: string;
}

export interface AtlasProjection {
  available: boolean;
  query: string;
  x: number;
  y: number;
  retrieved: {
    chunk_id: string;
    locator: string;
    score: number;
    preview: string;
  }[];
  considered: Record<string, number>;
  trace: RetrievalTrace;
  latency_ms: number;
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
  cached?: boolean;
  cache?: CacheInfo | null;
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
