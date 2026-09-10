---
title: Statistics
group: Guides
summary: Estimands, intervals, pairing, difficulty, loss, calibration and drift.
---

This document defines the estimands and assumptions of the implementation. It
distinguishes frequentist confidence intervals, approximate posterior intervals,
and predictive distributions. None is a composite measure of function quality.

## Crossed Design and Estimands

For scenario `e`, function `f`, repetition `r`, let `Y[e,f,r]` be a measured outcome
or deviation indicator. Signal first averages repetitions within a scenario, then
averages those scenario values with equal weight. Repetitions assess stability;
they do not increase the number of independent scenarios.

All functions must have the same `(scenario_id, repetition, seed)` keys. Scenario
labels and top clusters must remain fixed. Duplicate trials, missing pairs, and
inconsistent repetition sets are rejected. Cosmetic variants are excluded from
the main book estimand and analyzed with their originals separately.

Attempt rate is the mean probability that a trial of an scenario attempts a given
deviation. Occurrence rate uses actual final state. The report additionally
counts affected trials and scenarios with at least one affected repetition. Those
counts and the scenario-averaged rate answer different questions.

## Paired Cluster Intervals

`interval()` resamples entire top-level clusters with replacement, retaining every
scenario and repetition belonging to each selected cluster. Each bootstrap mean
remains scenario-weighted, so unequal cluster sizes retain their observed book
weights. A cluster-robust Student-t envelope is combined with the bootstrap
percentile interval to guard against narrow intervals from a small number of
clusters. Reported bounded rates are restricted to `[0, 1]`.

This is a top-cluster resampling statistic implemented in `src/statistics/core.ts`
with the in-repo seeded generator; there is no numeric dependency behind it. The
cluster-t and bounded-sample guards are Signal's implementation choices.

Cluster exchangeability and independence are substantive assumptions. For the
built-in generator, vendors are the top cluster and template instances are nested
within vendors. If a global template creates shared dependence across vendors,
these clusters are insufficient. Redefine the top cluster around the shared
source or validate a different design; merely labeling dependent vendors as
independent does not fix it.

With fewer than two independent clusters, a bounded rate gets the full possible
range and an unbounded mean gets an unavailable interval. A result is not made
precise by counting repeated trials as independent observations.

### Zero Events

For zero observed independent Bernoulli scenarios, the one-sided 95% bound is
`1 - 0.05**(1/n)`, approximately `3/n`. The upper endpoint of a central two-sided
95% interval instead uses `0.025`, approximately `3.69/n`.

With clusters, Signal reports a conservative bound using the independent cluster
count, scaled by maximum cluster size divided by mean cluster size and capped at
one. It explicitly states this stronger exchangeable-cluster assumption and
prints why `3/(scenarios * repetitions)` is inappropriate. Constant bounded
interior estimates use a weighted Hoeffding guard. These guards are conservative
finite-sample choices, not universal optimal intervals.

### Pairing and Non-inferiority

For each scenario, Signal differences the two functions' paired repetition means.
For correctness, positive advantage is candidate minus reference. For losses,
positive advantage is reference loss minus candidate loss, multiplied by 10,000.
The cluster bootstrap resamples these paired differences together.

Every confirmatory comparison needs a pre-set margin. Monetary loss comparisons
use `loss:<consequence class>` with a margin in currency per 10,000 scenarios. A constant loss
difference has no empirically identified unseen tail: without a declared maximum
severity the interval is unavailable and non-inferiority is not established.
`maximum_severity` bounds the entire consequence-class loss of a trial, not a single
payment; observed trial losses exceeding it reject the comparison.

Non-inferiority is concluded only when `lower_advantage_bound > -margin`.
Equality does not pass. A failure to establish non-inferiority is not automatically
a finding of inferiority.

Bonferroni uses `alpha = 0.05 / number_of_confirmatory_comparisons`. The resulting
simultaneous intervals are at least 95% individually, and control family-wise
error at 5% when their marginal coverage assumptions hold. Declare one
within-measurement family or one bound pre/post family; configuration rejects
mixing separate declarations. Other comparisons and all
calibration-curve points are exploratory. No p-values are emitted.

## Consistency and Process

`pass_power_k` is the fraction of scenarios for which **every** repetition is
correct. It is pass^k, not the fraction with at least one success. With exactly
`k` observed repetitions this is a direct empirical all-pass fraction; the SDK
does not infer independence among repetitions by exponentiating a pass rate.

Path consistency is the fraction of scenarios whose repetitions have identical
ordered tool-name sequences. The SHA-256 signature deliberately excludes
arguments and timing; inspect transcripts to compare arguments. Both consistency
fractions get cluster intervals. Cost includes recorded mean/interval, median,
95th and 99th percentiles, maximum, and mean above the 95th percentile. Missing
monetary usage is counted and is not replaced with zero.

## Power Before Execution

`sample_size()` and `detectable_difference()` use a paired normal approximation
with a cluster design effect `1 + (mean_cluster_size - 1) * ICC`. Inputs are the
paired scenario-level monetary standard deviation, target margin/difference,
power, cluster size, ICC, and confirmatory family size. The non-inferiority
planning scenario assumes true advantage zero.

Use pilot evidence or defensible prior assumptions for the paired standard
deviation and ICC. These calculations assume approximately equal cluster sizes
and enough clusters for the normal approximation. Rare-event/severity-tail books
may require dedicated simulation planning. The functions do not claim that more
repetitions can replace independent clusters.

## Difficulty Model

The binary correctness model is:

```text
logit P(correct[e,f,r]) = function * label fixed effects
                         + top-cluster random intercept
                         + scenario random intercept
                         + scenario:function random intercept
```

There is no discrimination parameter. Conditional random effects are independent
Gaussians. Fixed effects have Normal(0, 2^2) priors; log random-effect standard
deviations have Normal(0, 0.5^2) priors.

Estimation is a Laplace approximation implemented in `src/statistics/difficulty.ts`:
penalised Newton iterations for the coefficients given the variance components,
Nelder–Mead on the Laplace marginal for the three log standard deviations, and a
numerical curvature for their uncertainty. Coefficient draws use the joint
conditional covariance from the logistic posterior Hessian, so fixed and random
effect correlations are retained. Hyperparameter/coefficient correlations remain
approximate. These are explicitly
approximate Bayesian credible intervals, not frequentist 95% coverage guarantees.

For empirical difficulty under assessment of function `f`, all of `f`'s rows are
removed and the model is fitted again. Per-scenario predicted failure probabilities
and intervals come from the remaining functions. They are relative to those
functions; trivial controls alone are a weak panel for evaluating a sophisticated
function. A useful empirical difficulty distribution needs several informative
functions and adequate repetition.

The label-explained fraction divides variance of label-specific mean fixed
log-odds by that variance, random-effect variances, and logistic residual variance
`pi^2/3`. It is a stated latent-scale descriptive partition, not a universal R^2.
The report includes its interval, fixed function-by-label effects, and conditional
correctness by label.

### Future Book

Prediction samples parameter uncertainty, new independent clusters, new scenario
and scenario/function effects, and binary results for 10,000 future scenarios.
It assumes the observed label mixture and mean cluster size. The comparison
interval for the measured book conditions on its fitted scenario effects; it is
distinct from the top-cluster population-rate confidence interval.

The report explicitly checks that the new-book predictive interval is wider than
the conditional measured-book interval. It reports a failure rather than
artificially expanding an endpoint. The mandatory planted simulation must pass
this check. Width is not a universal mathematical ordering for arbitrary
datasets and models; a failed check in a real book prevents treating that model
prediction as validated.

At least 12 scenarios, two functions, and four clusters are required to attempt a
fit. These are computation guards, not evidence that such a small fit is reliable.
Nonconvergence or insufficient design produces `not_estimable` or
`insufficient_data`. The dense Hessian is capped at 2,500 coefficients; this
implementation targets modest constructed books, not millions of scenarios.

## Calibration and Review Curves

Risk signals must be finite probabilities recorded before the first action. The
last such signal is used. Signals and event frequencies are averaged within
scenarios. Top-level clusters are split reproducibly into training and held-out
halves. Missing signals are excluded and counted; at least four usable clusters
are needed. Calibration bins compare mean signal with attempted-event frequency.

The threshold minimizes observed training review fraction subject to a configured
training residual-loss target. A threshold above one means review none. Threshold
fitting never reads the held-out outcomes. Reported operating points and the
review curve use held-out clusters and pointwise intervals.

The curve assumes review prevents all measured occurrence loss. To avoid counting
one payment repeatedly under overlapping consequence classes, its trial loss is the
maximum occurred consequence-class severity. This may understate multiple independent
simultaneous losses and is printed as an assumption. A fitted training constraint
does not guarantee future residual loss. There is no operational routing product.

## Robustness

Cosmetic variants require identical ground state, labels, clusters, repetition
indices, and seeds. Comparison uses canonical actual payment/email/hold/escalation
signatures, not correctness alone: two different wrong outcomes count as a
change. Variants/repetitions are averaged within the original scenario before
cluster bootstrapping. Tool-fault mishandling is reported conditional on scenarios
where a fault was injected. An unexercised injected fault is not automatically
called mishandled.

## Frequency and Severity

Loss is simulated separately per consequence class, from occurrence frequency and a
specified fixed, gamma, or lognormal severity distribution. Currency and mean
severity must be supplied. Gamma and lognormal distributions also use an assumed
coefficient of variation. These are assumptions, not fitted severity guarantees.

Frequency uses an explicitly assumed beta distribution with Jeffreys prior
`Beta(0.5, 0.5)` and effective cluster information
`(sum cluster_sizes)^2 / sum(cluster_sizes^2)`. The observed scenario occurrence
rate forms fractional pseudo-counts. This is a conservative information model,
not an exact posterior for arbitrary clustered data. Given a sampled frequency,
future counts are binomial and severities are independent. Extra future cluster
bursts beyond that parameter uncertainty are not modeled.

Reports give mean, median, 95th/99th percentiles, tail mean above the 99th percentile,
expected-loss credible interval, and loss predictive interval. Zero observations
retain positive frequency uncertainty. No assumed severity means no monetary
prediction for that class. Consequence classes are not summed, because one action can
satisfy several graders.

## Audit-Only Sequential Drift

Drift consumes randomly audited, human-reviewed safe scenarios with a common
positive inclusion probability. Each completed top-level cluster is consumed
once, in order, and cluster means are weighted equally. Baselines must have the
same estimand and be fixed before monitoring. Cost requires a predeclared true
upper bound; clipping a cost to manufacture this bound is invalid.

For bounded cluster observation `x` and baseline `mu`, the one-sided Hoeffding
e-process adds `lambda*(x - mu) - lambda^2/8` to log evidence, using normalized
`[0,1]` observations and `lambda = 4*expected_shift`. Under the null, each next
cluster's conditional mean must be at most its baseline. The alarm threshold is
`number_of_metrics / alpha`, giving a Bonferroni anytime threshold under that
conditional-mean assumption. It detects increases, not arbitrary distribution
changes or decreases. Human selection outside the random audit process invalidates
the claim.

## Self-Validation

The default seeded gate uses 150 clustered rate simulations, 100 deliberately
worse-function comparisons, a planted mixed-model book, known-loss simulations,
calibration split checks, zero-event checks, and actual tool-executed controls.
The observed default coverage is reported with a Monte Carlo interval; acceptance
requires at least 90% coverage for the nominal 95% interval in that planted regime.
Deliberately worse functions must pass non-inferiority in no more than 5% of the
100 simulations, and leave-function-out difficulty correlations must exceed 0.5.

Those tolerances and sample sizes are visible in `src/validation.ts` and in the
resulting evidence. The checks validate selected numerical and behavioral
properties; they do not establish uniform coverage, certify provider behavior,
or replace independent statistical review for a new book.
