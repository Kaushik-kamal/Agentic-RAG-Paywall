# Deploying publicly

## Why this is a split deployment

The frontend is a Next.js app and belongs on Vercel. The backend is not
deployable there, and it is worth understanding why before you try:

| The API needs | Vercel serverless provides |
|---|---|
| SQLite `paywall.db` that survives a restart | Ephemeral filesystem |
| ChromaDB index (~14 MB on disk) | Ephemeral filesystem |
| `chromadb` + `langchain` + `stellar-sdk` (~250 MB) | Slow cold starts |
| Long-lived SSE streams | Duration caps |

On Vercel alone, every cold start would reset reputations to zero, wipe credit
balances, and delete the vector index. The demo would break mid-presentation.

So: **frontend on Vercel, backend as a container with a mounted disk.**

---

## Step 1 — Backend

`render.yaml` in the repository root is a ready blueprint. Render, Railway and
Fly.io all work; Render is the least setup.

1. Push the repository to GitHub (read the warning at the bottom of this page
   first).
2. Render dashboard → **New → Blueprint** → select this repository.
3. Fill in the secrets it prompts for:
   - `GEMINI_API_KEY` — your key
   - `STELLAR_PUBLIC_KEY` — from `python scripts/setup_stellar.py`
   - `CORS_ORIGINS` — leave blank for now; step 3 fills it in
   - `SECRET_KEY` and `ADMIN_API_KEY` are generated for you. Copy the admin key
     out of the dashboard — Vercel needs it in step 2.
4. Deploy, and note the URL, e.g. `https://agentic-rag-paywall-api.onrender.com`.
5. Seed the corpus and the network **once**, from the Render shell. The
   container's working directory is the `backend/` folder, so:

```bash
python scripts/seed_demo.py && python scripts/seed_marketplace.py
```

Confirm it took:

```bash
curl https://YOUR-API.onrender.com/api/v1/marketplace/stats
```

You want `"providers_online": 11`.

> **A paid instance is required.** Render's free tier has no persistent disk,
> and without one the seeded index disappears on the first restart — which is
> the exact failure this split deployment exists to avoid.

---

## Step 2 — Frontend

```bash
cd frontend && vercel login && vercel --prod
```

Set the **root directory to `frontend`** when prompted. Then add three
environment variables (Vercel dashboard → Settings → Environment Variables):

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://YOUR-API.onrender.com/api/v1` | Baked into the browser bundle **at build time** |
| `API_INTERNAL_URL` | same value | Server-side only, used by the upload proxy |
| `ADMIN_API_KEY` | the value Render generated | **Never** prefix with `NEXT_PUBLIC_` |

`.env.local` is gitignored and never reaches Vercel, so these must be set in the
dashboard. Real environment variables take precedence over `.env` files, so the
dashboard values win.

**Redeploy after setting `NEXT_PUBLIC_API_URL`.** It is inlined at build time,
not read at runtime — a restart will not pick it up:

```bash
vercel --prod --force
```

If you forget, the site still builds and every page still renders, but the
bundle keeps its development default and points at the visitor's own machine.
The app now detects this and shows a banner saying so, rather than presenting a
wall of empty panels.

---

## Step 3 — Connect the two

Set `CORS_ORIGINS` on Render to your Vercel URL and restart the service:

```
https://your-app.vercel.app
```

No trailing slash. This is the other half of the pair — without it the pages
render and every API call fails in the browser console.

---

## Step 4 — Verify it actually works

A green build is not a working product. Run the end-to-end checker against the
public URLs:

```bash
python scripts/verify_deployment.py --frontend https://your-app.vercel.app --backend https://your-api.onrender.com
```

It drives all six pages, then the whole money path — challenge, settlement,
token, paid query, semantic cache hit, ledger reconciliation — and scans the
shipped JavaScript for localhost URLs and leaked keys. It exits non-zero if
anything fails, so CI can gate on it. Tokens are reported by length, never by
value.

Then open the site in a private window and press **`D`**. If the demo runs
start to finish, you are done.

---

## The two decisions worth understanding

### Why `ENVIRONMENT=staging`, not `production`

`production` forces sandbox settlement off. A visitor with no Stellar wallet
could then never obtain credits, and the public demo would be unusable.

`staging` keeps sandbox settlement available while `ADMIN_API_KEY` still locks
the admin surface — uploads, deletes and provider registration all stay
protected. This is a deliberate choice for a public *demo*, and it is the one
setting on this page that would be wrong for a real production launch.

### Your Gemini quota is the attack surface

A public sandbox mints credits on request, and every credit spends your Gemini
quota. Someone could script it.

The blueprint ships tight limits (60 req/min per IP, 3 free credits, 5 per
payment), but they are a speed bump, not a wall. Before sharing the link widely:

- Set a **budget alert** in Google AI Studio
- Prefer sharing during judging over posting publicly
- If it is abused, set `X402_SANDBOX_MODE=false` and the tap closes immediately
  — the site stays up, visitors just cannot buy new credits

---

## Cheaper alternative if you only need it live for judging

Skip hosting the backend. Run it on your laptop and expose that one port:

```bash
npx localtunnel --port 8000
```

Point `NEXT_PUBLIC_API_URL` at the tunnel URL, add the same URL to
`CORS_ORIGINS`, and redeploy the frontend. Free, takes two minutes, and your
laptop keeps the disk — so the seeded index and reputations are already there.
The tunnel dies when you close it, which for a demo window is a feature.

---

## Redeploying later

```bash
cd frontend && vercel --prod --force
```

The backend has `autoDeploy: false`, so pushing to GitHub does not restart it —
use **Manual Deploy** in the Render dashboard. That is deliberate: an
accidental redeploy during judging is worse than a stale one.

Reseeding is **not** needed on redeploy; the disk persists. Only rerun the seed
scripts if you resize or replace the disk.

---

## ⚠️ Before you push to GitHub

`origin/main` still points at a commit containing a CV PDF. Connecting Vercel or
Render to that repository does not make the exposure worse, but "public use" is
exactly when the repo link gets shared.

See `SECURITY_NOTICE.md` in this folder and resolve it first.
