/** Explicit frequency/severity assumptions and compound loss simulation. */

import { type SeverityAssumption, ValidationError } from "../models.js";
import { type Estimate, type Rows, estimateMetric, scenarioGroups, validateRows } from "./core.js";
import { mean, quantile } from "./dist.js";
import { Rng } from "./random.js";

export interface HarmLoss {
  status: "simulated" | "severity_assumption_required"; currency?: string; occurrenceFrequency?: Estimate; severityAssumption?: Record<string, unknown>;
  mean?: number; median?: number; p95?: number; p99?: number; tailMeanAboveP99?: number; expectedLossInterval?: [number, number]; predictiveInterval?: [number, number];
  frequencyModel?: Record<string, number | string>; intervalKind?: string;
}

export interface LossResult { functionId: string; horizonScenarios: number; simulations: number; seed: number; harms: Record<string, HarmLoss>; assumptions: string[] }

export function lossDistribution(rows: Rows, options: {
  functionId: string; severityAssumptions: Record<string, SeverityAssumption>; simulations?: number; seed?: number; horizon?: number;
}): LossResult {
  const { functionId, severityAssumptions, simulations = 5000, seed = 0, horizon = 10000 } = options;
  const selected = rows.filter((r) => r.functionId === functionId);
  validateRows(selected);
  if (simulations < 100 || horizon < 1) throw new ValidationError("Use at least 100 simulations and a positive horizon");
  const rng = new Rng(seed);
  const groups = scenarioGroups(selected);
  const clusterSizes = new Map<string, number>();
  for (const trials of groups.values()) clusterSizes.set(trials[0].cluster, (clusterSizes.get(trials[0].cluster) ?? 0) + 1);
  const weights = [...clusterSizes.values()];
  const total = weights.reduce((a, b) => a + b, 0);
  const effectiveClusters = total ** 2 / weights.reduce((a, b) => a + b * b, 0);
  const harms = [...new Set([...selected.flatMap((r) => Object.keys(r.occurred ?? {})), ...Object.keys(severityAssumptions)])].sort();
  const output: Record<string, HarmLoss> = {};
  for (const harm of harms) {
    const assumption = severityAssumptions[harm];
    if (!assumption) { output[harm] = { status: "severity_assumption_required" }; continue; }
    const kind = assumption.distribution ?? "fixed";
    const meanSeverity = Number(assumption.mean ?? assumption.amount ?? 0);
    if (!Number.isFinite(meanSeverity) || meanSeverity < 0) throw new ValidationError("Assumed severity mean must be finite and nonnegative");
    if (!assumption.currency) throw new ValidationError("Every severity assumption must state its currency");
    if (!["fixed", "gamma", "lognormal"].includes(kind)) throw new ValidationError("Severity distribution must be fixed, gamma or lognormal");
    const cv = Number(assumption.coefficientOfVariation ?? 1);
    if (!Number.isFinite(cv) || cv <= 0) throw new ValidationError("coefficientOfVariation must be positive and finite");
    const frequency = mean([...groups.values()].map((trials) => mean(trials.map((r) => (r.occurred?.[harm] ? 1 : 0)))));
    // Clusters, not repeated trials, carry the frequency information: an explicitly assumed conservative beta model.
    const a = 0.5 + frequency * effectiveClusters, b = 0.5 + (1 - frequency) * effectiveClusters;
    const totals = new Float64Array(simulations), expected = new Float64Array(simulations);
    for (let s = 0; s < simulations; s++) {
      const f = rng.beta(a, b);
      const count = rng.binomial(horizon, f);
      let loss = count * meanSeverity;
      if (meanSeverity > 0 && kind === "gamma" && count > 0) {
        const shape = 1 / cv ** 2;
        loss = rng.gamma(count * shape, meanSeverity / shape);
      } else if (meanSeverity > 0 && kind === "lognormal") {
        const sigma = Math.sqrt(Math.log1p(cv ** 2)), mu = Math.log(meanSeverity) - sigma ** 2 / 2;
        loss = 0;
        for (let k = 0; k < count; k++) loss += rng.lognormal(mu, sigma);
      }
      totals[s] = loss;
      expected[s] = f * horizon * meanSeverity;
    }
    const p99 = quantile(totals, 0.99);
    output[harm] = {
      status: "simulated", currency: assumption.currency, occurrenceFrequency: estimateMetric(selected, `occurrences:${harm}`, { seed }),
      severityAssumption: { ...assumption, distribution: kind, mean: meanSeverity },
      mean: mean(totals), median: quantile(totals, 0.5), p95: quantile(totals, 0.95), p99,
      tailMeanAboveP99: mean(Array.from(totals).filter((v) => v >= p99)),
      expectedLossInterval: [quantile(expected, 0.025), quantile(expected, 0.975)],
      predictiveInterval: [quantile(totals, 0.025), quantile(totals, 0.975)],
      frequencyModel: { family: "beta", priorAlpha: 0.5, priorBeta: 0.5, posteriorAlpha: a, posteriorBeta: b, effectiveIndependentClusters: effectiveClusters },
      intervalKind: "95% assumption-dependent posterior credible/predictive intervals",
    };
  }
  return { functionId, horizonScenarios: horizon, simulations, seed, harms: output,
    assumptions: ["Severity distributions are assumptions, not inferred guarantees.",
      "Frequency uses an assumed beta model with effective top-level cluster counts and Jeffreys prior.",
      "Future occurrence counts are conditionally binomial; clustered bursts beyond parameter uncertainty are not modeled.",
      "Severity is independent of frequency and scenarios within each harm class.",
      "Harm classes are reported separately because the same occurrence may satisfy multiple graders.",
      "Zero observed events retain nonzero frequency uncertainty."] };
}
