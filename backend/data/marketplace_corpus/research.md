# Machine Learning Systems in Production

## Training–serving skew

The most common production failure is not model quality but a mismatch between how
features are computed at training time and at inference time. Offline pipelines
aggregate over complete history; online pipelines see partial, late-arriving data.

The structural fix is a single feature definition consumed by both paths — a feature
store — rather than two implementations kept in sync by discipline. Where that is
impractical, log the exact features used at inference and train on those logs.

## Data leakage

Leakage is any information in the training set that will not be available at
prediction time. It produces excellent offline metrics and worthless production
behaviour.

Common sources: computing normalisation statistics before the train/test split;
target encoding without cross-fold isolation; and splitting time-series data
randomly rather than chronologically, which lets the model see the future.

## Evaluation

Accuracy is misleading under class imbalance: a model predicting the majority class
for a 1% positive rate scores 99%. Precision, recall, and their trade-off along the
precision–recall curve carry the information. ROC-AUC is insensitive to imbalance in
a way that flatters rare-event models; PR-AUC does not.

Offline metrics predict online performance only under the assumption that the
serving distribution matches the evaluation distribution. Interleaving experiments
and A/B tests are how that assumption gets checked.

## Drift

**Covariate drift** is a change in the input distribution; **concept drift** is a
change in the relationship between inputs and target. The first can be detected
without labels by monitoring feature distributions; the second cannot, and requires
delayed ground truth.

A monitoring system that watches only accuracy discovers concept drift as late as
the labels arrive — which for many problems is weeks. Watching prediction
distributions and feature distributions gives earlier, if weaker, signal.

## Retrieval-augmented systems

For systems that ground generation in retrieved documents, evaluation splits into
**retrieval quality** — is the answer present in the retrieved set — and
**generation quality** — is the answer faithful to it. Measuring only end-to-end
correctness cannot distinguish a retrieval failure from a hallucination, and the two
have opposite fixes.

Recall@k on a labelled query set diagnoses the retriever. Faithfulness — whether
every claim is supported by a retrieved passage — diagnoses the generator. Citation
coverage is a cheap and surprisingly effective proxy for the second.

## Reproducibility of models

A model artefact is reproducible only if the data snapshot, the code version, the
hyperparameters, and the random seeds are all recorded together. Versioning code
without versioning data reproduces the pipeline, not the model.
