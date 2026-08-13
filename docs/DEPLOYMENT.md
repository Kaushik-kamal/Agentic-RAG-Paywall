# Deploying publicly

**Live frontend:** https://agentic-rag-paywall.vercel.app

## Why this is a split deployment

The frontend is a Next.js app and belongs on Vercel. The backend is not
deployable there, and it is worth understanding why before you try:

| The API needs | Vercel serverless provides |
|---|---|
| SQLite `paywall.db` that survives a restart | Ephemeral filesystem |
| ChromaDB index (~14 MB on disk) | Ephemeral filesystem |
| `chromadb` + `langchain` + `stellar-sdk` (~250 MB) | Slow cold starts |
| Long-lived SSE streams | Duration caps |

So: **frontend on Vercel, backend as a container.**

---

## Step 1 — Backend on Render

`render.yaml` in the repository root is a ready blueprint, configured for the
**free** instance type.

1. Render dashboard → **New → Blueprint** → select
   `Kaushik-kamal/Agentic-RAG-Paywall` → branch `main`.
2. Fill in the two secrets it prompts for:
   - `GEMINI_API_KEY` — your key
   - `STELLAR_PUBLIC_KEY` — from `python backend/scripts/setup_stellar.py`
   - `CORS_ORIGINS` — set to `https://agentic-rag-paywall.vercel.app`
   - `SECRET_KEY` and `ADMIN_API_KEY` are generated for you. Copy the admin key
     out of the dashboard; Vercel needs it in step 2.
3. Deploy, and note the URL, e.g. `https://agentic-rag-paywall-api.onrender.com`.

### You do not need to run the seed scripts

The free tier has no persistent disk, so the container starts empty on every
restart. `AUTO_SEED=true` handles it: on boot, an instance with no providers
indexes the bundled corpora and registers all eleven seed providers on a
background thread. Verified locally — providers went 0 → 11 in about 60
seconds, with `/health` answering immediately throughout, so the platform's
health check never sees a failure.

Watch it happen:

```bash
curl https://YOUR-API.onrender.com/health
```

`bootstrap.state` moves `seeding` → `ready`. Then confirm:

```bash
curl https://YOUR-API.onrender.com/api/v1/marketplace/stats
```

You want `"providers_online": 11`.

### What the free tier costs you

- **Cold starts.** Render idles a free instance after ~15 minutes. The next
  request waits ~60s for the container, then up to a minute more for reseeding.
  **Hit the URL a few minutes before you present.**
- **History resets.** The corpus and providers always come back; accumulated
  ledger entries and earned reputation do not.

Upgrading to `plan: starter` and restoring the `disk:` block in `render.yaml`
fixes both. `AUTO_SEED` then becomes a harmless no-op.

If you ever need to seed by hand, the scripts are under `backend/`, and the
container's working directory is that folder:

```bash
python scripts/seed_demo.py && python scripts/seed_marketplace.py
```

---

## Step 2 — Point the frontend at it

The project is already linked to Vercel as
`kamal-sharmas-projects-9233858e/agentic-rag-paywall`. Set three variables
(dashboard → Settings → Environment Variables, or the CLI below):

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://YOUR-API.onrender.com/api/v1` | Inlined **at build time** |
| `API_INTERNAL_URL` | same value | Server-side only, used by the upload proxy |
| `ADMIN_API_KEY` | the value Render generated | **Never** prefix with `NEXT_PUBLIC_` |

```bash
cd frontend && vercel env add NEXT_PUBLIC_API_URL production
```

`.env.local` is gitignored and excluded by `.vercelignore`, so it never reaches
the build — these must be set in Vercel.

**Then redeploy.** `NEXT_PUBLIC_API_URL` is baked into the bundle, so a restart
will not pick it up:

```bash
cd frontend && vercel deploy --prod --force
```

Forget this and the site still builds and every page still renders, but the
bundle keeps its development default and aims at the visitor's own machine. The
app now detects exactly that and shows a banner saying so.

---

## Step 3 — Verify it actually works

A green build is not a working product.

```bash
python scripts/verify_deployment.py --frontend https://agentic-rag-paywall.vercel.app --backend https://YOUR-API.onrender.com
```

It waits out cold starts and boot seeding, drives all six pages, then the whole
money path — challenge, settlement, token, paid query, semantic cache hit,
ledger reconciliation — and scans the shipped JavaScript for localhost URLs and
leaked keys. Non-zero exit on failure. Tokens are reported by length, never by
value.

Then open the site in a private window and press **`D`**.

---

## The two decisions worth understanding

### Why `ENVIRONMENT=staging`, not `production`

`production` forces sandbox settlement off. A visitor with no Stellar wallet
could then never obtain credits, and the public demo would be unusable.

`staging` keeps sandbox settlement available while `ADMIN_API_KEY` still locks
the admin surface — uploads, deletes and provider registration all stay
protected. Deliberate for a public *demo*, and the one setting here that would
be wrong for a real production launch.

### Your Gemini quota is the attack surface

A public sandbox mints credits on request, and every credit spends your Gemini
quota. Someone could script it.

The blueprint ships tight limits (60 req/min per IP, 3 free credits, 5 per
payment), but they are a speed bump, not a wall. Set a **budget alert** in
Google AI Studio. If it is abused, set `X402_SANDBOX_MODE=false` — the site
stays up, visitors just cannot buy new credits.

---

## Redeploying later

```bash
cd frontend && vercel deploy --prod --force
```

The backend has `autoDeploy: false`, so pushing to GitHub does not restart it —
use **Manual Deploy** in the Render dashboard. That is deliberate: an
accidental redeploy during judging is worse than a stale one.

---

## ⚠️ The repository is public and its history contains a CV

`origin/main`'s current tree is clean, but the file is still fetchable at commit
`9be4d25`. Removing the tracked file was not sufficient. See
`SECURITY_NOTICE.md` — resolving it requires either deleting and recreating the
GitHub repository or rewriting history with a force push, both of which are
your call to make.
