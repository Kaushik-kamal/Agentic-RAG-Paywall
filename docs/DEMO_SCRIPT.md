# Three-Minute Demo Script

**Total: 3:00.** Two browser tabs, one terminal. Everything below runs live.

---

## Before you walk on

```bash
# Terminal 1 — API
cd backend && venv\Scripts\activate && uvicorn app.main:app --port 8000

# Terminal 2 — web
cd frontend && npm run dev

# Terminal 3 — leave this sitting at the prompt, pre-typed, do not press Enter
cd backend
python scripts/agent_client.py --stream "Why does the x402 memo matter?"
```

Open `http://localhost:3000`. Press **⌘K → Marketplace** once to warm the route,
then come back to `/`. Confirm the landing counters are non-zero.

**Fallback:** if the network is unreliable on the day, the demo still runs — the
timeline never waits on a request. A slow provider simply lands late. If the API
is fully down, skip to the terminal at 2:10 and talk over the architecture.

---

## 0:00 – 0:25 · The problem

**Screen:** landing page.

**Say:**

> Every AI agent today can only call APIs that a human wired into it months ago.
> It cannot go looking for a capability it lacks, compare what is on offer, or
> transact with a service it has never met.
>
> Two things are missing. A way for services to be *discovered*. And a way for an
> agent to *pay* without a signup form.
>
> We built both.

**Demonstrates:** the thesis.
**Why judges care:** it frames everything that follows as infrastructure, not a
chatbot.

---

## 0:25 – 1:00 · The cinematic

**Screen:** press **D** — or click **Start demo**.

Let it run. Do not narrate over the boot card. Speak into the gaps.

**Say, at roughly these moments:**

> *(at "Dispatching agents")* Four agents. A legal researcher, a clinician, an
> engineer, a compliance officer. None of them knows a single endpoint.
>
> *(at "Discovering the marketplace")* They're reading a live registry — eleven
> services, each publishing its capabilities, its price, its latency, and a
> reputation it earned.
>
> *(at "Settling micropayments")* That's real settlement. Each agent is paying a
> different provider a different amount, because they chose different providers.
>
> *(at "Retrieving knowledge")* And this is the embedding space. The question just
> landed next to the passages that answer it.

**Ends on the summary card.** Read it out, slowly:

> Four autonomous agents. Forty-four provider evaluations. Four micropayments.
> Four knowledge transactions. **Zero human interventions.**
>
> Thirty seconds. Every number on that card was produced by live API calls while
> you watched.

**Demonstrates:** the entire product in one motion.
**Why judges care:** this is the memory they leave with. Everything after is proof.

---

## 1:00 – 1:35 · Prove the routing is real

**Screen:** `/discover`. Click the chip **"Does a conference paper count as prior art?"**

**Say:**

> Now let me show you it isn't scripted.
>
> *(as the pipeline fills)* It matched the phrase "prior art" and chose the patent
> provider — which is also the most expensive and the slowest on the network.
>
> *(scroll to the scoreboard)* And here's every provider it turned down, each one
> saying why. "Outmatched — thirty-eight percent intent match against ninety-one
> for the leader."

Then switch the objective to **Cheapest** and re-run the same question.

> Same question, different objective. It still won't route to the cheap
> generalist, because capability *multiplies* the score rather than adding to it.
> A provider that can't answer isn't a cheaper option — it's the wrong one.

**Demonstrates:** explainable ranking, capability gating, objective weighting.
**Why judges care:** an unexplainable router is an unusable router. This one shows
its work and refuses to be bought.

---

## 1:35 – 2:10 · Prove the knowledge is real

**Screen:** `/atlas`. Type **"how fast does a ledger close"** → **Project**.

**Say:**

> Every passage in the corpus is a three-thousand-dimensional vector. This is that
> space, flattened onto its two principal components.
>
> The question lands next to its answers — not because the words match, but
> because the meanings do. The dashed lines are exactly what the retriever chose.
>
> We used PCA rather than t-SNE for one reason: it's linear, so a *new* query
> projects into the same basis. The prettier algorithms can't place a new point
> without refitting, which would make this overlay a lie.

**Demonstrates:** the retrieval layer, and honesty about method.
**Why judges care:** it's the moment "semantic search" stops being a phrase and
becomes a picture.

---

## 2:10 – 2:40 · Prove the money is real

**Screen:** terminal 3. Press Enter.

**Say:**

> This agent has no wallet. Watch.
>
> It generates a Stellar keypair, funds it from Friendbot, and — *(point)* — that
> is a real payment on the Stellar testnet. Three seconds.

Copy the transaction hash, paste it into **stellar.expert**.

> There it is. On chain. Anyone in this room can verify it.

**Demonstrates:** the x402 settlement layer, end to end, outside the browser.
**Why judges care:** it separates "we drew a payment flow" from "we settled a
transaction you can independently check."

---

## 2:40 – 3:00 · The close

**Screen:** `/dashboard`.

**Say:**

> Every figure here came from the ledger. The transactions you just watched are in
> that list. Reputations moved because of them — and they'll influence the next
> routing decision.
>
> Ninety-four tests, zero of which need an API key. The routing model was rebuilt
> once during development because the first version let a cheap provider outbid a
> competent one — and that failure is now a test.
>
> This is what the agent economy needs underneath it: discovery, pricing,
> settlement, and reputation. It's all open source, and it's all running right now.

**Stop talking.**

---

## Questions you will get

**"Are the providers actually separate services?"**
> They share one deployment and settle into one treasury, attributed per provider —
> and the README says so in the second section rather than burying it. What *is*
> real: disjoint knowledge scopes, independent pricing, independent reputation. Ask
> the medical provider a contract question and it genuinely refuses. The registry
> is open — `POST /marketplace/providers` lists a third-party service that's
> rankable from its first request.

**"How do you stop a provider gaming its reputation?"**
> Today, Bayesian smoothing — one lucky call can't buy a top grade, and the history
> is replayed from the event ledger so it can't disagree with the live score. What's
> missing is skin in the game: signed listings and staking are the next step, and
> they're in the roadmap.

**"What happens if the LLM hallucinates?"**
> Every claim carries a citation marker that resolves to a passage. Confidence is
> computed from retrieval similarity and citation coverage — never the model's own
> self-assessment, because models are badly calibrated about that. A low score and
> uncited sentences are both visible to the reader.

**"Why Stellar?"**
> Fees around a hundred-thousandth of a cent and five-second finality. At
> card-network economics a tenth-of-a-cent purchase is impossible — the fee is
> larger than the product.

---

## If something breaks

| Symptom | What to do |
|---|---|
| A provider is slow mid-demo | Say nothing. The timeline advances anyway; the answer lands late. |
| An agent shows **failed** | *"That call failed and the credit was refunded automatically — it's recorded against that provider's reliability."* This is a feature. |
| API is down entirely | Press **Esc**, go to the terminal, run `pytest` and talk over the architecture. 94 tests in 8 seconds is its own demo. |
| Credits run out | The director tops up automatically at the boot phase. If it didn't, click the credit chip → **Settle**. |
