# The Stellar Network

Stellar is an open-source, public blockchain designed for moving value quickly and
cheaply across borders. It launched in 2014 and is maintained by the non-profit
Stellar Development Foundation.

## Stellar Consensus Protocol

Stellar does not use proof of work or proof of stake. It uses the Stellar Consensus
Protocol (SCP), a construction of Federated Byzantine Agreement.

Every node publishes a **quorum slice**: the set of other nodes it personally trusts
to not collude against it. Consensus emerges when these overlapping slices form
quorums across the network. Because trust is declared locally rather than assigned
by stake or hash power, there is no mining, no block reward, and no energy cost.

SCP guarantees safety over liveness. If the network partitions badly enough that
quorum intersection fails, nodes halt rather than fork. Halting is recoverable;
a ledger fork is not.

### Ledger close time

A new ledger closes approximately every 5 seconds. A transaction included in a
closed ledger is final — Stellar has no probabilistic confirmation and no reorgs,
so applications do not wait for a confirmation depth the way Bitcoin clients do.

## Lumens (XLM)

The native asset is the lumen, ticker XLM. Lumens serve three purposes:

1. **Transaction fees.** The base fee is 100 stroops, where one stroop is
   0.0000001 XLM. A simple payment therefore costs 0.00001 XLM — a fraction of a
   cent at any realistic price.
2. **Minimum balances.** Every account must hold a base reserve of 0.5 XLM, plus
   0.5 XLM per additional entry such as a trustline or offer. A plain account with
   no sub-entries requires 1 XLM.
3. **Bridge currency.** Path payments can route through XLM to convert between
   two issued assets in a single atomic operation.

Fees rise above the base only when a ledger is oversubscribed, at which point
Stellar runs a surge-pricing auction and includes the highest-bidding transactions.

## Accounts and keypairs

An account is identified by an Ed25519 public key, encoded as a 56-character
string beginning with `G`. The corresponding secret key begins with `S` and must
never leave the holder's control.

Accounts do not exist on-chain until they are funded with at least the base
reserve. On the test network, the **Friendbot** service funds any address with
10,000 test XLM on request, which makes automated testing free.

## Memos

Every transaction can carry an optional memo of up to 28 bytes of text, or a
32-byte hash or numeric identifier. Memos are how a receiving service attributes
an incoming payment to a specific customer, invoice, or session, because the
sending address alone is often a shared custodial wallet.

A payment protocol that issues a unique memo per invoice can therefore match
settlement to intent without a separate messaging channel.

## Horizon

Horizon is the HTTP API server that sits in front of a Stellar Core node. Clients
submit transactions to `POST /transactions` and read history from REST endpoints
such as `/accounts/{id}`, `/transactions/{hash}`, and
`/transactions/{hash}/operations`.

Horizon also exposes streaming endpoints over Server-Sent Events, so a service can
subscribe to payments to an address rather than polling.

The public testnet Horizon instance runs at `https://horizon-testnet.stellar.org`
and is reset periodically, which is why testnet keys should never be reused for
anything of value.

## Operations

A Stellar transaction bundles one to one hundred operations that succeed or fail
atomically. The operations most relevant to payments are:

- `payment` — send a specific amount of a specific asset to an existing account.
- `create_account` — fund and create an account that does not yet exist, using the
  `starting_balance` field.
- `path_payment_strict_send` / `path_payment_strict_receive` — convert between
  assets along an order-book path in one step.

Because `create_account` carries value in `starting_balance` rather than `amount`,
a verifier that only inspects `payment` operations will miss the very first payment
made to a brand-new account.
