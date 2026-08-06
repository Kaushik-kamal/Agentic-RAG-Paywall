# Research Methods and Statistical Inference

## What a p-value is and is not

A p-value is the probability of observing data at least as extreme as those
obtained, *assuming the null hypothesis is true*. It is not the probability that the
null hypothesis is true, not the probability the result is due to chance, and not a
measure of effect size.

A threshold of 0.05 is a convention, not a law of nature. Dichotomising continuous
evidence at an arbitrary point discards information and creates a cliff edge where
p = 0.049 and p = 0.051 are treated as categorically different.

## Statistical power

Power is the probability of detecting an effect of a given size if it exists. It
depends on sample size, effect size, variance, and the significance threshold.

Underpowered studies fail twice. They miss real effects, and — less obviously — the
significant results they do produce are systematically inflated, because only
unusually large sample estimates clear the threshold. This is the winner's curse,
and it is why small significant studies frequently fail to replicate.

Post-hoc power calculated from the observed effect is uninformative; it is a
deterministic function of the p-value and adds nothing.

## Multiple comparisons

Testing many hypotheses at α = 0.05 guarantees false positives: twenty independent
tests yield roughly one significant result by chance alone. Bonferroni correction
controls the family-wise error rate but is conservative; false discovery rate
procedures such as Benjamini–Hochberg control the expected proportion of false
positives among rejections and are usually more appropriate for exploratory work.

Researcher degrees of freedom — choosing outcomes, covariates, exclusions and
subgroups after seeing the data — inflate false positives far beyond any nominal
correction. Pre-registration constrains them; a clear labelling of exploratory
analyses as exploratory is the minimum honest alternative.

## Reproducibility

**Reproducibility** means obtaining the same result from the same data and code.
**Replicability** means obtaining a consistent result from new data. The first is a
matter of shared materials and should be near-universal; it is not.

Barriers are practical: undocumented preprocessing, unversioned dependencies,
unavailable raw data, analyses performed in a spreadsheet. Publishing the analysis
code and a dependency manifest resolves most of them.

## Causal inference from observational data

Correlation supports causal claims only under assumptions that must be stated.
Confounding is controlled by conditioning on a sufficient adjustment set — which
requires a causal model, not a regression that includes every available variable.

Conditioning on a collider, a variable caused by both exposure and outcome, induces
spurious association where none existed. "Adjust for everything measured" is
therefore not a conservative strategy; it can manufacture the very bias it was
meant to remove.
