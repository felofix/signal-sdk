---
title: Statistics functions
slug: statistics-functions
group: SDK reference
summary: The estimators underneath rulers and certificates, implemented in-repo with no numeric dependencies.
---

```ts
import { calibrate, compare, detectDrift, detectableDifference, difficulty, interval, lossDistribution, robustness,
         sampleSize, summarize, Rng, normPpf, tPpf, quantile } from "signal-sdk/statistics";

interval(values: number[], clusters: string[], { alpha = 0.05, samples = 2000, seed = 0, bounds = null }): Estimate
summarize(rows, { bootstrapSamples = 2000, seed = 0 }): { functions: Record<string, FunctionSummary>, unit, resamplingUnit }
compare(rows, referenceId, candidateId, { comparisons = [], bootstrapSamples = 2000, seed = 0, familySize = null }): CompareResult
difficulty(rows, { seed = 0, futureScenarios = 10000, draws = 1000 }): DifficultyResult
calibrate(rows, { functionId, targetResidualLoss = null, seed = 0, bins = 5, bootstrapSamples = 1000 }): CalibrationResult
robustness(rows, { bootstrapSamples = 1000, seed = 0 }): RobustnessResult
lossDistribution(rows, { functionId, severityAssumptions, simulations = 5000, seed = 0, horizon = 10000 }): LossResult
sampleSize(marginCurrencyPer10000, pairedSdCurrency, { power = 0.8, icc = 0, clusterSize = 1, comparisons = 1 })
detectableDifference(scenarios, pairedSdCurrency, { power = 0.8, icc = 0, clusterSize = 1, comparisons = 1 })
detectDrift(auditRows, { baselines, alpha = 0.05, expectedShift = 0.1, costUpperBound = null }): DriftResult
```

## Example

```ts
import { observationRows } from "signal-sdk";
import { compare, difficulty, summarize } from "signal-sdk/statistics";

const rows = observationRows(measurement);
const summary = summarize(rows, { bootstrapSamples: 1000 });
console.log(summary.functions[fn.id].consistency.passPowerK);

const report = compare(rows, reference.id, candidate.id, { comparisons: [
  { name: "acc", metric: "correct", margin: 0.02, confirmatory: true },
  { name: "leak", metric: "loss:external_send", margin: 500, maximumSeverity: 5000, confirmatory: true },
] });
console.log(report.comparisons.map((c) => c.conclusion));

const hard = difficulty(rows, { seed: 1 });
console.log(hard.status, hard.predictions[fn.id]?.nextBookCorrectRate);
```

## What each returns

| Function | Result |
|---|---|
| `interval` | `estimate`, `interval`, `confidence`, `scenarios`, `clusters`, `method`, `zeroEventNote`. Top-cluster bootstrap with cluster-t envelope; conservative guards for degenerate samples. |
| `summarize` | Per function: `outcome` (correct, fieldF1, attempted/occurred deviation, escalatedWhenImpossible, by label and by threat), `events` (per attempted/occurred key: deviation, mechanisms, mandate_attempt, consequence classes), `process` (+ cost distribution), `consistency` (pass^k, path), `metrics`. The per-threat outcome and mechanism columns are built by `outcomeColumn()` and `mechanismColumn()` from `signal-sdk`. |
| `compare` | Paired scenario differences with Bonferroni family-wise intervals and a `non_inferior` / `not_established` / `exploratory` conclusion per comparison. |
| `difficulty` | Logistic mixed model `correct ~ function × label + (1|cluster) + (1|scenario) + (1|scenario:function)` fitted by Laplace approximation with Nelder–Mead on the three variance components; leave-function-out difficulty per scenario, label-explained variance, posterior predictions for the next 10,000 scenarios with a width check. Needs 12 scenarios, 2 functions, 4 clusters; dense, so capped at 2,500 coefficients. |
| `calibrate` | Risk signal versus attempted events; threshold fitted on half the clusters, curves reported on the other half. |
| `robustness` | Cosmetic outcome-change fraction over variants; tool-fault mishandled fraction. |
| `lossDistribution` | Per consequence class: simulated loss per 10,000 scenarios from occurrence frequency (Jeffreys beta) and an assumed fixed / gamma / lognormal severity; mean, percentiles, tail mean, intervals. |
| `sampleSize`, `detectableDifference` | Paired normal approximation with cluster design effect. |
| `detectDrift` | Hoeffding e-process per metric over completed audit clusters, Bonferroni anytime threshold. Audit rows only. |

## Numerics

`Rng` is a seeded xoshiro128** generator with normal, gamma, beta, binomial and lognormal draws. `normPpf`, `tPpf`, `betaPpf`, `proportionInterval`, `quantile`, `spearman` and the Cholesky solver are small, tested implementations in `src/statistics/`. There are no numeric dependencies to trust.

See [Statistics guide](#/statistics) for estimands and assumptions.
