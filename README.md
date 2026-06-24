# Agentic RAG Paywall

> **A platform where AI agents pay Stellar x402 micropayments to access a LangChain + Gemini RAG knowledge API.**

---

## Architecture

```
AI Agent  →  HTTP POST /rag/query
          ←  HTTP 402 (X-Payment-Address, X-Payment-Amount)
          →  Stellar Payment (0.01 XLM on testnet)
          →  POST /payments/verify (tx_hash)
          ←  access_token (JWT)
          →  POST /rag/query + Authorization: Bearer <token>
          ←  Gemini answer + sources + cost
```

## Tech Stack

| Layer      | Tech                                         |
|------------|----------------------------------------------|
| Frontend   | Next.js 16 · TypeScript · Tailwind CSS v4    |
| Backend    | FastAPI · Python 3.11 · Pydantic v2          |
| AI / LLM   | Gemini 2.0 Flash (Google AI)                 |
| RAG        | LangChain · ChromaDB (persistent)            |
| Embeddings | Gemini text-embedding-004                    |
| Payments   | Stellar SDK · x402 micropayment protocol     |
| Auth       | HMAC-signed access tokens                    |

---

## Quick Start

### Prerequisites

- Node.js ≥ 18  
- Python ≥ 3.11  
- A free [Gemini API key](https://aistudio.google.com)  
- A [Stellar testnet keypair](https://laboratory.stellar.org/#account-creator?network=test)

---

### 1 · Backend (FastAPI)

```bash
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Configure environment
copy .env.example .env       # Windows
# cp .env.example .env       # macOS/Linux
# → Fill in GEMINI_API_KEY and STELLAR_* keys in .env

# Run the server
uvicorn app.main:app --reload --port 8000
```

API docs → http://localhost:8000/docs  
Health check → http://localhost:8000/health

---

### 2 · Frontend (Next.js)

```bash
cd frontend

npm install   # already done if you ran setup

# Environment (already pre-filled for local dev)
# frontend/.env.local is ready

npm run dev
```

Open → http://localhost:3000

---

### 3 · Ingest Documents

```bash
# Upload a PDF or text file to the knowledge base
curl -X POST http://localhost:8000/api/v1/rag/ingest \
  -F "file=@your_document.pdf"
```

---

### 4 · Run the Demo

1. Open http://localhost:3000/demo  
2. Pick a preset query or type your own  
3. Click **Run Demo**  
4. Watch the 6-step pipeline animate:  
   Query → HTTP 402 → Stellar payment → Token → ChromaDB → Gemini answer

> **Demo mode**: The demo uses `demo_<hash>` transaction hashes that bypass live Stellar verification so you can test without a real wallet. Set real `STELLAR_SECRET_KEY` for production use.

---

## API Reference

| Method | Endpoint                      | Description                        |
|--------|-------------------------------|------------------------------------|
| GET    | `/health`                     | Health check                       |
| GET    | `/api/v1/stats`               | Global platform stats              |
| POST   | `/api/v1/payments/challenge`  | Get x402 payment challenge         |
| POST   | `/api/v1/payments/verify`     | Verify Stellar tx + get token      |
| GET    | `/api/v1/payments/price`      | Current price per query            |
| POST   | `/api/v1/rag/query`           | Query knowledge base (auth needed) |
| POST   | `/api/v1/rag/ingest`          | Upload document to ChromaDB        |
| GET    | `/api/v1/rag/stats`           | RAG pipeline stats                 |
| POST   | `/api/v1/agents/register`     | Register an AI agent               |

---

## Project Structure

```
Agentic-RAG-Paywall/
├── frontend/                  # Next.js 16 app
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx       # Landing page
│   │   │   ├── dashboard/     # Analytics dashboard
│   │   │   └── demo/          # AI buyer demo
│   │   ├── components/
│   │   │   ├── layout/        # Navbar, Footer
│   │   │   └── ui/            # Card, Badge
│   │   └── lib/
│   │       └── api.ts         # Typed API client
│   └── .env.local
│
├── backend/                   # FastAPI app
│   ├── app/
│   │   ├── main.py
│   │   ├── api/endpoints/
│   │   │   ├── rag.py         # RAG query + ingest
│   │   │   ├── payments.py    # Stellar x402
│   │   │   └── agents.py      # Agent registry
│   │   ├── services/
│   │   │   ├── rag_service.py     # LangChain + ChromaDB + Gemini
│   │   │   └── stellar_service.py # Stellar SDK + HMAC tokens
│   │   └── core/config.py
│   ├── data/                  # ChromaDB + uploads (auto-created)
│   ├── requirements.txt
│   └── .env
│
└── .env.example
```

---

## Stellar x402 Protocol

The x402 protocol works like HTTP Basic Auth but for micropayments:

1. Client requests a protected resource  
2. Server returns `HTTP 402` with payment instructions in headers  
3. Client pays on Stellar (3–5 second settlement)  
4. Client presents transaction hash to get an access token  
5. Client uses access token to access the resource  

This is fully autonomous — AI agents handle steps 1–5 without human intervention.

---

## License

MIT
