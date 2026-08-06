# The x402 Payment Protocol

x402 is a convention for machine-to-machine payments built on the HTTP status code
`402 Payment Required`, which was reserved in the original HTTP specification and
left unused for three decades.

## The problem it solves

Existing monetisation assumes a human. API keys require someone to sign up, accept
terms, and enter a card. Subscriptions require a billing relationship that predates
the first request. Neither works when the client is an autonomous agent that
discovered your endpoint thirty seconds ago and needs one answer.

x402 removes the account entirely. The client learns the price from the response,
pays, and retries. There is no signup, no card on file, and no minimum commitment.

## The handshake

1. **Unpaid request.** The client calls a protected endpoint with no credential.
2. **402 challenge.** The server answers `402 Payment Required` with payment
   instructions in both headers and the JSON body:

   ```
   X-Payment-Address:   GAGK...NWKH
   X-Payment-Amount:    0.01
   X-Payment-Asset:     XLM
   X-Payment-Network:   testnet
   X-Payment-Memo:      x402-9f3a21c8
   X-Payment-Challenge: chal_4b7e...
   X-Payment-Expires:   2026-08-05T12:31:00+00:00
   ```

3. **Settlement.** The client submits a payment for the exact amount to the exact
   address, carrying the exact memo.
4. **Verification.** The client presents the transaction hash. The server re-reads
   the transaction from the chain and checks destination, asset, amount, memo, and
   success before granting anything.
5. **Access.** The server returns a short-lived bearer token and a bundle of query
   credits. The client retries the original request with the token.

The entire loop completes in about five seconds on Stellar, dominated by ledger
close time rather than by the API.

## Why the memo matters

Without a memo, a server that sees an incoming payment cannot tell which of its
callers sent it. Custodial wallets share addresses across thousands of users, so
the source account is not a reliable identity.

Binding a unique memo to each challenge makes attribution unambiguous and closes
a race in which two agents pay simultaneously and one claims the other's credit.

## Replay protection

A transaction hash is public the moment it settles. Anyone watching the network can
copy it. The server must therefore record every redeemed hash and reject repeats.

Storing redeemed hashes in memory is insufficient: a restart forgets them and the
paywall reopens. A unique constraint in a durable store is the correct mechanism.

## Credits versus session tokens

A naive implementation issues a token that is valid for an hour and lets the holder
call the endpoint as often as they like. That is a subscription with extra steps,
and it prices a thousand queries the same as one.

The correct model separates the two concerns:

- The **token proves identity** — which agent is calling.
- The **credit ledger holds value** — how many answers that agent has bought.

Each answer debits exactly one credit inside the same transaction that records it.
A stolen token then buys nothing once the balance reaches zero, and a failed
generation can be refunded precisely.

## Pricing

Micropayments only work when the fee is far below the price. Stellar's base fee of
0.00001 XLM against a query price of 0.01 XLM means fees are roughly a tenth of a
percent of revenue. On a chain with dollar-scale fees the model is impossible.

Selling credits in bundles amortises the settlement round-trip: one payment of
0.01 XLM granting ten credits means an agent pays once and asks ten questions.

## Comparison to alternatives

| Approach          | Signup | Per-call cost | Settlement | Agent-friendly |
|-------------------|--------|---------------|------------|----------------|
| API key + invoice | Yes    | Amortised     | Monthly    | No             |
| Subscription      | Yes    | Fixed         | Monthly    | No             |
| Card per call     | Yes    | ~$0.30 + 2.9% | Days       | No             |
| x402 on Stellar   | No     | ~$0.000001    | ~5 seconds | Yes            |

The decisive column is settlement time. An agent cannot wait days for a card to
clear before it is allowed to think.
