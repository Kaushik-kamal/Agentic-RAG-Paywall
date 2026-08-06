# The Agentic Economy

An agentic economy is one in which software agents — not people — are the buyers.
An agent discovers a capability, evaluates whether it is worth the price, pays, and
consumes it, without a human approving each step.

## What breaks when the buyer is software

Commerce infrastructure encodes assumptions about human buyers that fail silently
when the buyer is an agent.

**Onboarding assumes patience.** A signup flow costs a person two minutes and an
agent an eternity. An agent evaluating twelve knowledge sources cannot create
twelve accounts.

**Pricing assumes volume.** Subscription tiers are designed around predictable
monthly usage. An agent may make exactly one request to a given API in its lifetime.

**Settlement assumes trust.** Card networks front the money and reconcile later,
which is why chargebacks exist. Agents have no credit history and no legal identity
to pursue.

**Authorisation assumes intent.** "Do you approve this $4.99 charge?" is unanswerable
by a process with no user attached.

## What an agent-native payment looks like

- **Priced in the response.** The cost is discoverable from the endpoint itself, not
  from a pricing page written for humans.
- **Settled in seconds.** Any latency the agent cannot amortise is latency in the
  agent's own task.
- **Fee-negligible.** If the network fee is a meaningful fraction of the price, the
  transaction is not worth making.
- **Attributable without identity.** A memo or invoice reference is enough; a legal
  entity is not.
- **Refundable programmatically.** When the service fails, the credit returns
  without a support ticket.

## Metering models

**Per-call.** One payment, one response. Maximum precision, maximum settlement
overhead. Suited to expensive individual calls.

**Credit bundles.** One payment grants N calls. Amortises settlement while keeping
consumption metered. This is the model most agent APIs converge on.

**Streaming or subscription.** Continuous payment for continuous access. Efficient
at high volume, but reintroduces the account relationship x402 removes.

The choice is a trade-off between settlement overhead and pricing precision. Credit
bundles sit at the useful middle: pay once, meter honestly.

## Trust without accounts

An agent transacting with an unknown API needs assurances that traditionally came
from a business relationship:

- **The service delivered what it charged for.** Answering with citations lets the
  agent verify the response against retrievable sources.
- **The price was what was advertised.** The challenge states the exact amount
  before payment; the verification checks it after.
- **Failure did not cost money.** Refunding the credit when generation fails is what
  makes retrying safe.

These properties are enforced by protocol, not by contract, which is what makes the
interaction possible between parties that have never met.

## Composability

Once capabilities are priced and payable over HTTP, agents can chain them. A
research agent might pay one API for retrieval, another for summarisation, and a
third for verification, treating each as a metered function call with a known cost.

The economic layer becomes as composable as the API layer — which is only true when
payment is as fast and as programmable as the request itself.
