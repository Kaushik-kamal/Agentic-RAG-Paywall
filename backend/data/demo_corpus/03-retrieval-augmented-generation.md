# Retrieval-Augmented Generation

Retrieval-Augmented Generation (RAG) grounds a language model's output in documents
fetched at query time, rather than relying on what the model memorised during
training.

## Why grounding matters

A language model trained on a fixed corpus has three failure modes that RAG
addresses directly:

1. **Staleness.** Training data has a cutoff. RAG reads the current document.
2. **Hallucination.** With no evidence in context, a model produces fluent,
   confident, wrong text. With evidence in context and an instruction to cite it,
   ungrounded claims become visible.
3. **Attribution.** A trained-in fact cannot be traced. A retrieved passage can be
   shown to the reader.

RAG does not eliminate hallucination. It makes hallucination *checkable*, which is
the property that matters for a paid API.

## The pipeline

### Ingestion

Documents are parsed to text, split into chunks, embedded into vectors, and stored
alongside their metadata in a vector index.

### Retrieval

The query is embedded with the same model family, and the index returns the nearest
chunks by cosine similarity.

### Generation

The retrieved chunks are numbered and inserted into the prompt. The model is
instructed to answer only from them and to cite the block numbers it used.

## Chunking

Chunking is where most RAG systems quietly lose accuracy.

A fixed-size character splitter cuts sentences in half and separates a claim from
the heading that scoped it. The chunk "must be at least 0.5 XLM" is useless without
"Minimum balances" above it.

Better strategies:

- **Structure-aware splitting.** Segment on headings first, and carry the heading
  breadcrumb into every chunk derived from that section. The breadcrumb changes the
  embedding and doubles as a citation label.
- **Sentence-boundary packing.** Fill a chunk with whole paragraphs, and whole
  sentences when a paragraph is oversized, rather than cutting at an arbitrary
  character offset.
- **Overlap by sentence, not character.** Carrying the last two sentences into the
  next chunk preserves a claim that straddles a boundary; carrying the last 200
  characters usually preserves half a word.

Typical chunk sizes land between 800 and 1,500 characters with 10–20% overlap.
Smaller chunks retrieve precisely but lose context; larger chunks retain context
but dilute the embedding.

## Embeddings and task types

Embedding models map text into a vector space where semantic similarity becomes
geometric proximity. Google's `text-embedding-004` produces 768-dimensional vectors
and accepts a task type hint.

Using `RETRIEVAL_DOCUMENT` when indexing and `RETRIEVAL_QUERY` when searching
measurably improves recall, because questions and passages have different surface
statistics — a question is short, interrogative, and rarely contains the answer's
vocabulary.

## Hybrid retrieval

Dense vector search understands paraphrase: "how fast does it settle" retrieves a
passage about "ledger close time" with no shared words. It is weak on rare literal
tokens — error codes, identifiers, product names — because such tokens are poorly
represented in the embedding space.

BM25, a sparse lexical ranking function, is the mirror image: exact on rare terms,
blind to paraphrase.

**Reciprocal Rank Fusion** combines them without needing their scores to be
comparable. For a document appearing at rank *r* in a list, it contributes
`1 / (k + r)` to the fused score, where *k* is typically 60. Summing across lists
rewards documents that both retrievers liked, and rescues documents that one
retriever ranked first and the other missed entirely.

## Re-ranking and diversity

Raw top-k results are often near-duplicates from the same document. Two mitigations:

- **Near-duplicate suppression.** Compare token shingles between candidates and drop
  a chunk that substantially repeats one already selected.
- **Per-document caps.** Limit how many chunks any single document may contribute,
  so one verbose source cannot crowd out a more relevant short one.

## Measuring confidence

Asking a model how confident it is produces a number that correlates weakly with
correctness — models are poorly calibrated on their own output.

More reliable signals are external to the generation:

- Similarity of the top retrieved chunk.
- Mean similarity across the selected set.
- What fraction of the retrieved chunks the answer actually cited.
- What fraction of factual sentences carry a citation marker.
- Whether the answer contains an explicit refusal phrase.

Combining these produces a score that moves for reasons a reader can inspect, which
is far more useful than a model's self-report.

## RAG versus fine-tuning

Fine-tuning changes model weights to shift style, format, or domain vocabulary. RAG
changes what the model can see at inference time.

Use fine-tuning to teach a model *how* to respond. Use RAG to give it *what* to
respond about. Facts that change — prices, policies, inventory, documentation —
belong in retrieval, because updating an index takes seconds and retraining does
not.
