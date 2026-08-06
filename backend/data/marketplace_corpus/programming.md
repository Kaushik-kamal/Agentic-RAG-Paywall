# Distributed Systems Engineering

## The CAP theorem, precisely

Under a network partition, a distributed system must choose between consistency and
availability. The theorem says nothing about the non-partitioned case, where a
system can and should offer both. The practical framing is PACELC: **if** Partition,
choose Availability or Consistency; **else**, choose Latency or Consistency.

Most production databases sit on a spectrum rather than at a corner. "Eventually
consistent" is a family of guarantees, not a single one.

## Consistency models

**Linearizability** makes the system behave as if every operation took effect
instantaneously at some point between invocation and response. It is the strongest
single-object guarantee and the most expensive.

**Sequential consistency** preserves each client's program order but allows a global
order that no real-time clock would agree with.

**Causal consistency** preserves happens-before relationships and nothing more. It is
available under partition, which linearizability is not, and is sufficient for a
surprising number of applications.

**Read-your-writes** and **monotonic reads** are session guarantees — weak, cheap, and
usually what users actually notice the absence of.

## Consensus

Consensus protocols — Paxos, Raft, Viewstamped Replication — let a majority of nodes
agree on an ordered log despite crashes. All require a quorum, typically a strict
majority, so a five-node cluster tolerates two failures.

Raft decomposes the problem into leader election, log replication, and safety, which
is why it is more widely implemented than Paxos despite being equivalent in power. A
leader accepts writes, replicates to followers, and commits once a majority
acknowledges. On leader failure, an election with randomised timeouts resolves the
split.

Consensus cannot make progress without a majority. A partition that leaves no side
with a quorum halts writes — the correct behaviour, and one that operators
frequently misdiagnose as a bug.

## Idempotency and exactly-once

Exactly-once delivery is impossible over an unreliable network. Exactly-once
*processing* is achievable by combining at-least-once delivery with idempotent
handlers or a deduplication key committed atomically with the effect.

The common failure is deduplicating in one store and applying the effect in another,
with no transaction spanning both. The fix is either a single transactional
boundary, or the outbox pattern: write the effect and the intent to publish in one
transaction, then publish asynchronously.

## Backpressure and timeouts

Every remote call needs a timeout, a bounded retry policy with jitter, and a circuit
breaker. Retries without jitter synchronise clients into a thundering herd. Retries
without a budget turn a partial outage into a total one, because the retry traffic
becomes the load.
