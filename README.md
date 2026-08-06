<div align="center">

# Agentic RAG Paywall

**An Agent Discovery Network — where AI agents find, evaluate, pay for and consume
services they have never seen before.**

No endpoint is configured anywhere. An agent arrives with a question, reads a live
marketplace of AI services, ranks them on capability, reputation, price and latency,
settles an HTTP `402` micropayment on Stellar with whichever one wins, and returns a
cited answer — in about three seconds.

[![CI](https://github.com/Kaushik-kamal/Agentic-RAG-Paywall/actions/workflows/ci.yml/badge.svg)](https://github.com/Kaushik-kamal/Agentic-RAG-Paywall/actions/workflows/ci.yml)
![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![Stellar testnet](https://img.shields.io/badge/Stellar-testnet-0f6bff?logo=stellar&logoColor=white)
![License MIT](https://img.shields.io/badge/license-MIT-green)

</div>

---

## The problem

Today an AI agent can only call APIs someone wired into it in advance. It cannot
go looking for a capability it lacks, compare what is on offer, or transact with a
service it has never met. Every integration is a human decision made months earlier.

Two things are missing, and this repository builds both.

**A way to discover.** Services need to publish what they can do, what they charge,
how fast they are, and how well they have performed — in a registry an agent can
read and rank at request time.

**A way to pay.** Discovery is worthless if settlement needs a signup form. `402
Payment Required` sat unused in the HTTP spec for thirty years; it turns out to be
exactly the right primitive. The server quotes the price in the response, the client
pays, the client retries. On Stellar the fee is ~0.00001 XLM and the ledger closes
in five seconds, so a $0.001 purchase is economically real.

Put them together and an agent can do what a person does: find someone who can help,
decide whether they are worth it, pay them, and use the result.

```
Agent (knows nothing)
  ↓  understands intent
  ↓  searches the registry            11 providers listed
  ↓  filters on declared capability   2 can actually answer
  ↓  ranks on trust · price · latency under a stated objective
  ↓  explains the choice              and what it gave up
  ↓  settles on Stellar               0.03 XLM, 3 credits
  ↓  invokes the winner               over that provider's own knowledge scope
  ↓  returns a cited answer           81% confidence
  ↓  writes the outcome to reputation influencing the next decision
```

## Is the marketplace real?

Yes, in every way that matters to the demonstration — and the README says exactly
where the seams are rather than letting a judge discover them.

**Real:** eleven providers with **disjoint knowledge scopes**, independent prices
(0.005–0.035 XLM), independent latency profiles, independent retrieval
configuration, and reputations computed only from transactions that actually
happened. Route a contract question to the clinical provider and it genuinely
answers *"not in my sources"* — which is precisely why routing correctly is a real
problem rather than a scripted animation.

**Shared:** they run on one deployment and settle into one treasury, attributed
per provider. Nothing about the protocol assumes that — `POST /marketplace/providers`
registers a third-party service that is rankable from its first request.

---

## What it does

```
┌──────────┐  1. POST /rag/query (no credential)      ┌─────────────────┐
│          │ ───────────────────────────────────────▶ │                 │
│    AI    │  2. 402 + address, amount, memo          │    FastAPI      │
│  agent   │ ◀─────────────────────────────────────── │    paywall      │
│          │                                          │                 │
│          │  3. payment ───▶ ┌──────────┐            │                 │
│          │                  │ Stellar  │            │                 │
│          │  ◀── tx hash ─── │ ~5s      │            │                 │
│          │                  └──────────┘            │                 │
│          │  4. POST /payments/verify (hash)         │  ┌───────────┐  │
│          │ ───────────────────────────────────────▶ │  │  credit   │  │
│          │  ◀── access token + 10 credits           │  │  ledger   │  │
│          │                                          │  └───────────┘  │
│          │  5. POST /rag/query (Bearer token)       │        │        │
│          │ ───────────────────────────────────────▶ │   debit 1 ▼     │
│          │  ◀── streamed answer + citations         │  ┌───────────┐  │
└──────────┘         + confidence score               │  │ RAG       │  │
                                                      │  │ pipeline  │  │
                                                      │  └───────────┘  │
                                                      └─────────────────┘
```

### The discovery layer

| | |
|---|---|
| **Open registry** | Providers publish capabilities, keywords, price, latency, model and knowledge scope. `POST /marketplace/providers` lists a new one; it is ranked from its first request with no code change. |
| **Capability as a ceiling** | The router *multiplies* by capability rather than adding it, so a cheap generalist can never outbid the domain expert. Price, speed and trust compete only within a capability tier. This is the single most important line in the ranker — without it, automated routing is untrustworthy. |
| **Stated objective** | `balanced`, `quality`, `cheapest` or `fastest` re-weight the commercial factors. The objective is shown, the weights are shown, and changing it visibly changes the winner. |
| **Explainability** | Every decision reports why the winner won, what the runner-up was, what was given up by not choosing it, and **why each rejected provider was rejected** — "outmatched: 42% intent match against 87% for the leader". |
| **Earned reputation** | Trust blends reliability, answer quality, latency against the advertised figure, and experience — each Bayesian-smoothed toward a prior, so one lucky call does not buy an AAA. Nothing is pre-seeded; a judge watches reputations form. |
| **Auditable history** | The reputation chart is replayed cumulatively from the event ledger, so it can never disagree with the live score. |

### The paywall

| | |
|---|---|
| **Priced in the response** | An unpaid call returns `402` with `X-Payment-Address`, `X-Payment-Amount`, and a `X-Payment-Memo` that binds the payment to the request. |
| **Credits, not sessions** | The token proves *identity*; the ledger holds *value*. Each answer debits one credit inside the transaction that records it — a stolen token buys nothing once the balance is spent. |
| **Verified on-chain** | Destination, asset, amount, memo, and success are all re-read from Horizon. Replay is blocked by a `UNIQUE` constraint that survives a restart. |
| **Failure is free** | If generation fails or the client disconnects mid-stream, the credit is refunded automatically. |

### The retrieval

| | |
|---|---|
| **Structure-aware chunking** | Splits on heading structure and packs whole sentences. Each chunk carries its breadcrumb (`Doc › Section › Subsection`), which improves the embedding *and* becomes the citation label. |
| **Hybrid search** | Dense Gemini embeddings fused with BM25 through Reciprocal Rank Fusion. Paraphrase and rare literal tokens both land. |
| **Diversity control** | Near-duplicate suppression by token shingles, plus a per-document cap so one verbose source cannot crowd out a better short one. |
| **Grounded generation** | Numbered context, forced `[n]` markers on every factual sentence, and an explicit instruction to refuse when the context does not support an answer. |
| **Auditable confidence** | Scored from retrieval similarity and citation coverage — *not* the model's self-assessment, which is poorly calibrated. Every input to the score is shown in the UI. |
| **Streaming** | Server-Sent Events. The retrieval trace lands before the first word; follow-up questions arrive in the same stream at no extra latency. |
| **Semantic cache** | A repeat question — *however it is phrased* — is served from cache in ~0.5 s and charged **zero credits**. Matching is by query embedding, so "how fast does Stellar settle" hits an entry stored for "what is the ledger close time". Keyed by corpus revision, so any upload invalidates it. |

### Two things you can only see by looking

**The corpus atlas** (`/atlas`) projects every chunk onto its two principal
components and lets you drop a live query into the same space. Because PCA is
*linear*, a new point can be placed in the existing basis — t-SNE and UMAP look
tidier but cannot, which would make the overlay a lie. Type a question and watch
it land among its answers, with lines drawn to exactly what retrieval selected.

**The agent swarm** (`/protocol#swarm`) launches up to twelve agents that each run
the whole x402 loop concurrently against the live API. It closes by reconciling
the ledger against the server's own balances — *"72 credits across the swarm,
expected 72. Exact — no credit was double-spent or lost under concurrency."*
That is the atomicity claim, proven rather than asserted.

---

## Screenshots

> Replace these placeholders with real captures before submitting.

| Discovery — the agent choosing a provider it has never seen | Marketplace — eleven services publishing their terms |
|---|---|
| ![Discovery](docs/screenshots/discover.png) | ![Marketplace](docs/screenshots/marketplace.png) |

| One click — a fleet transacting across the network | Corpus atlas — a query landing among its answers |
|---|---|
| ![Network demo](docs/screenshots/network-demo.png) | ![Atlas](docs/screenshots/atlas.png) |

---

## Quick start

### Prerequisites

- **Python 3.11+** and **Node.js 20.9+**
- A free [Gemini API key](https://aistudio.google.com/apikey)
- No wallet needed — the setup script provisions and funds a Stellar testnet
  account from Friendbot.

### 1 · Backend

```bash
cd backend

python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux

pip install -r requirements.txt

copy ..\.env.example .env      # Windows
# cp ../.env.example .env      # macOS / Linux
# → set GEMINI_API_KEY in backend/.env

python scripts/setup_stellar.py     # provisions + funds a testnet treasury
python scripts/list_models.py       # confirm your key's available models
python scripts/seed_demo.py         # index the core corpus
python scripts/seed_marketplace.py  # index 10 domains, list 11 providers

uvicorn app.main:app --reload --port 8000
```

Interactive API docs → <http://localhost:8000/docs>

### 2 · Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. You start with three free credits.

### 3 · Watch an agent pay for real

```bash
cd backend
python scripts/agent_client.py --stream "Why does the x402 memo matter?"
```

This creates a Stellar keypair, funds it from Friendbot, **submits a real payment
on the testnet**, redeems the hash for credits, and streams a cited answer. The
transaction hash it prints is verifiable on
[Stellar Expert](https://stellar.expert/explorer/testnet).

Add `--sandbox` to skip the chain when you are offline.

---

## Architecture

```
Agentic-RAG-Paywall/
├── backend/                        FastAPI · Python 3.12
│   ├── app/
│   │   ├── main.py                 App factory, middleware, lifespan
│   │   ├── core/
│   │   │   ├── config.py           Settings + production hardening validators
│   │   │   ├── security.py         HMAC access tokens
│   │   │   ├── errors.py           Typed errors → one JSON envelope
│   │   │   ├── rate_limit.py       Sliding-window limiter
│   │   │   └── logging.py          Structured logs with request IDs
│   │   ├── db/
│   │   │   ├── database.py         SQLite (WAL), schema, transactions
│   │   │   └── repository.py       The only module that writes SQL
│   │   ├── services/
│   │   │   ├── loaders.py          PDF · DOCX · MD · TXT · CSV · JSON
│   │   │   ├── chunking.py         Heading-aware, sentence-boundary packing
│   │   │   ├── embeddings.py       Gemini embeddings, batched + cached
│   │   │   ├── vector_store.py     ChromaDB, cosine, per-document deletes
│   │   │   ├── registry.py         Open provider registry + event ledger
│   │   │   ├── reputation.py       Bayesian trust scoring and history replay
│   │   │   ├── router_agent.py     Intent → filter → rank → explain
│   │   │   ├── marketplace.py      Discover → pay → invoke → score
│   │   │   ├── retrieval.py        Dense + BM25 → RRF → dedupe → trace
│   │   │   ├── answer_cache.py     Embedding-matched cache; repeats cost 0
│   │   │   ├── atlas.py            PCA projection of the embedding space
│   │   │   ├── generation.py       Prompting, citations, confidence
│   │   │   ├── rag_service.py      Orchestration (ingest · search · answer)
│   │   │   ├── stellar_service.py  Challenge · on-chain verify · credits
│   │   │   └── x402.py             Protocol headers and body shape
│   │   └── api/endpoints/          rag · documents · payments · agents ·
│   │                               conversations · system
│   ├── scripts/
│   │   ├── setup_stellar.py        Generate + fund a testnet treasury
│   │   ├── seed_demo.py            Index the demo corpus
│   │   ├── list_models.py          Show models this API key can call
│   │   └── agent_client.py         Reference agent — pays on-chain, for real
│   ├── data/demo_corpus/           Primary material the demo answers from
│   └── tests/                      63 tests · no network, no API keys
│
└── frontend/                       Next.js 16 · React 19 · Tailwind v4
    └── src/
        ├── app/
        │   ├── page.tsx            Landing
        │   ├── discover/           Routing agent + one-click network demo
        │   ├── marketplace/        Provider cards, leaderboard, detail pages
        │   ├── console/            Streaming chat + citations + retrieval
        │   ├── atlas/              Embedding-space map, live query overlay
        │   ├── library/            Upload and manage documents
        │   ├── protocol/           x402 walkthrough + agent swarm
        │   ├── dashboard/          Real analytics
        │   └── api/documents/      BFF — holds the admin key server-side
        ├── components/
        │   ├── console/            AnswerBody · CitationRail · Confidence ·
        │   │                       RetrievalTrace · PaywallDialog
        │   ├── atlas/              Embedding-space map with live query overlay
        │   ├── protocol/           x402 walkthrough · SwarmSimulator
        │   ├── charts/             Dependency-free SVG charts
        │   ├── layout/             Navbar · Footer · ⌘K command palette
        │   ├── providers/          Session (x402 client) · Theme · Toast
        │   └── ui/                 Design-system primitives
        └── lib/
            ├── api.ts              Typed client
            ├── stream.ts           SSE parser
            └── types.ts            Shared response shapes
```

### Design decisions worth defending

- **SQLite, not Postgres.** Single node, tiny write volume, zero configuration.
  A judge clones the repo and their data survives a restart. All SQL lives in
  one repository module, so swapping engines is a contained change.
- **Chroma directly, not through a framework adapter.** We need the cosine
  metric, per-chunk scores, and precise deletes when a document is removed.
- **`gemini-3.1-flash-lite` by default.** The reasoning models spend 20+ seconds
  thinking before emitting a token, which makes a streamed answer feel broken.
  Extracting from supplied context is exactly what a lite model does well —
  first token lands in ~1.2s. Run `scripts/list_models.py` to see your options.
- **Charts hand-rolled in SVG.** A charting library costs ~90 KB gzipped for two
  shapes; these re-theme for free from the same CSS variables as everything else.
- **A Next.js BFF for uploads only.** Reads and paid calls go straight to
  FastAPI. Writes route through a server handler so `ADMIN_API_KEY` never
  reaches the browser.

---

## API reference

Full interactive docs at `/docs`. The essentials:

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET`  | `/api/v1/marketplace/providers` | — | Enumerate every service on the network |
| `POST` | `/api/v1/marketplace/providers` | Admin key | **List a new service** — open registry |
| `POST` | `/api/v1/marketplace/discover` | — | Rank the network against a request, free |
| `POST` | `/api/v1/marketplace/route` | Bearer | **Autonomous end-to-end routing** (SSE) |
| `POST` | `/api/v1/marketplace/compare` | Bearer | Send one request to several providers |
| `GET`  | `/api/v1/marketplace/stats` | — | Live marketplace metrics and leaderboard |
| `POST` | `/api/v1/rag/query` | Bearer · 1 credit | Ask a question, get a cited answer |
| `POST` | `/api/v1/rag/stream` | Bearer · 1 credit | Same, as Server-Sent Events |
| `POST` | `/api/v1/rag/search` | — | Semantic search, retrieval only, free |
| `GET`  | `/api/v1/rag/atlas` | — | 2D PCA projection of the whole corpus |
| `POST` | `/api/v1/rag/atlas/project` | — | Place a query in the atlas, free |
| `POST` | `/api/v1/payments/challenge` | — | Get an x402 payment challenge |
| `POST` | `/api/v1/payments/verify` | — | Redeem a transaction hash for credits |
| `GET`  | `/api/v1/payments/balance/{agent_id}` | — | Remaining credits |
| `GET`  | `/api/v1/payments/account` | — | Treasury balance and status |
| `POST` | `/api/v1/agents/register` | — | Register an agent, get trial credits |
| `POST` | `/api/v1/documents` | Admin key | Upload and index a document |
| `GET`  | `/api/v1/documents` | — | List indexed documents |
| `DELETE` | `/api/v1/documents/{id}` | Admin key | Delete a document and its vectors |
| `GET`  | `/api/v1/conversations` | — | Conversation history for an agent |
| `GET`  | `/api/v1/health` | — | Component-level health |
| `GET`  | `/api/v1/analytics` | — | Time series and rankings |

### Stream events

`start` → `status` → `retrieval` → `token`\* → `follow_ups` → `done`,
with a terminal `error` event (and an automatic refund) on failure.

### Error shape

Every error looks the same, so agents branch on `code` rather than parsing prose:

```json
{
  "error": {
    "code": "insufficient_credits",
    "message": "Query credits exhausted. Settle another x402 payment to continue.",
    "details": { "destination": "GAGK…", "amount_xlm": 0.01, "memo": "x402-9f3a21c8" }
  },
  "request_id": "a3f19c8e"
}
```

---

## Environment variables

See [`.env.example`](.env.example) for the annotated list. The ones that matter:

| Variable | Default | Notes |
|----------|---------|-------|
| `GEMINI_API_KEY` | — | **Required.** Embeddings and generation. |
| `SECRET_KEY` | random per process | Signs access tokens. **Required and stable in production.** |
| `ADMIN_API_KEY` | — | Guards knowledge-base writes. Required in production. |
| `STELLAR_PUBLIC_KEY` | — | Treasury account. `scripts/setup_stellar.py` fills it in. |
| `X402_PRICE_XLM` | `0.01` | Price of one payment. |
| `X402_CREDITS_PER_PAYMENT` | `10` | Answers bought per payment. |
| `X402_SANDBOX_MODE` | `true` | Accepts `sandbox_*` hashes. **Forced off when `ENVIRONMENT=production`.** |
| `ENVIRONMENT` | `development` | `production` enables the hardening validators. |

---

## Deployment

### Docker Compose

```bash
export GEMINI_API_KEY=...          # required
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(48))")
export ADMIN_API_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(24))")
export ENVIRONMENT=production
export STELLAR_PUBLIC_KEY=G...     # from scripts/setup_stellar.py

docker compose up --build
```

The API runs unprivileged with a healthcheck; state lives on a named volume so
containers stay disposable. `NEXT_PUBLIC_API_URL` is inlined at build time, so
set it to the URL a *browser* can reach.

### Split deployment (Vercel + a container host)

1. **Frontend → Vercel.** Root directory `frontend`. Set `NEXT_PUBLIC_API_URL`
   to the public API URL, plus `API_INTERNAL_URL` and `ADMIN_API_KEY` as
   server-side variables.
2. **Backend → Fly.io / Render / Railway.** Deploy `backend/Dockerfile`, mount a
   volume at `/app/data`, and set `CORS_ORIGINS` to your Vercel domain.
3. Set `ENVIRONMENT=production` — this refuses sandbox payments, requires a
   treasury account and an admin key, and disables debug output.

### Production checklist

- [ ] `SECRET_KEY` set and stable (rotating it invalidates every live token)
- [ ] `ADMIN_API_KEY` set; uploads reachable only through the BFF
- [ ] `CORS_ORIGINS` restricted to your real domains
- [ ] `STELLAR_NETWORK=public` and a funded mainnet treasury, if going live
- [ ] `LOG_JSON=true` for structured logs
- [ ] Volume mounted at `/app/data` so SQLite and Chroma survive restarts

---

## Testing

```bash
cd backend
pytest                  # 94 tests, no network or API keys required
ruff check app scripts tests
```

```bash
cd frontend
npx tsc --noEmit
npm run lint
npm run build
```

The backend suite stubs the vector store and the LLM, so it is hermetic and runs
in seconds. It covers the paywall economics (replay, expiry, atomic debit,
refund-on-failure), token forgery, chunking, retrieval fusion, citation parsing,
confidence scoring, the SSE event sequence, upload validation, path traversal,
semantic-cache hit/miss and invalidation, PCA determinism and basis stability,
and the production-hardening validators.

The marketplace tests pin down the properties the demo claims: that a domain
expert beats a 50×-cheaper generalist, that the `cheapest` objective still refuses
an incapable provider, that reputation cannot reach 100% on one success, that
failures pull it back down, and that the replayed history always agrees with the
live score.

---

## Roadmap

- **Genuinely independent providers** — separate deployments, separate treasuries,
  settlement split on-chain rather than attributed in one ledger
- **Provider-signed listings** so a registry entry cannot be forged, and staking so
  a bad actor has something to lose
- **Negotiation** — an agent proposing a price and a provider accepting, declining
  or counter-offering, instead of take-it-or-leave-it listings
- **Mainnet settlement** with a hardware-backed treasury key and a withdrawal flow
- **Postgres + pgvector** behind the existing repository interface, for multi-node
- **Cross-encoder reranking** on the fused candidate set for another recall bump
- **Per-agent pricing tiers** — volume discounts settled in the same ledger
- **Webhook callbacks** so an agent can be notified when a long document finishes indexing
- **OCR fallback** for scanned PDFs
- **Streaming settlement** via Stellar payment channels, for high-frequency callers
- **Multi-tenant knowledge bases**, scoped by agent

---

## License

MIT — see [LICENSE](LICENSE).
