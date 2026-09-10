/** Cluster-held-out calibration, review curves, and paired robustness. */

import { ValidationError } from "../models.js";
import { type Estimate, type Rows, interval, scenarioGroups, validateRows } from "./core.js";
import { mean } from "./dist.js";
import { Rng } from "./random.js";

interface Point { id: string; cluster: string; signal: number; attempt: number; loss: number }

export interface CalibrationResult {
  status: "estimated" | "insufficient_data"; reason?: string; excludedScenarios: number; chosenThreshold: number | null;
  calibrationCurve: { bin: [number, number]; meanSignal: number; attemptRate: Estimate }[];
  reviewCurve: { threshold: number; reviewFraction: Estimate; residualLossPer10000: Estimate }[];
  split?: { unit: string; seed: number; trainingClusters: string[]; testClusters: string[]; trainingScenarios: number; testScenarios: number };
  trainingTargetResidualLossPer10000?: number; heldOutOperatingPoint?: { threshold: number; reviewFraction: Estimate; residualLossPer10000: Estimate };
  assumptions?: string[];
}

/**
 * Select a review threshold on training clusters and report on held-out clusters.
 * Reviewing is assumed to avert the entire observed loss; this is a measurement curve, not a router.
 */
export function calibrate(rows: Rows, options: { functionId: string; targetResidualLoss?: number | null; seed?: number; bins?: number; bootstrapSamples?: number }): CalibrationResult {
  const { functionId, targetResidualLoss = null, seed = 0, bins = 5, bootstrapSamples = 1000 } = options;
  const selected = rows.filter((r) => r.functionId === functionId);
  validateRows(selected);
  if (bins < 2 || (targetResidualLoss !== null && targetResidualLoss < 0)) throw new ValidationError("Use at least two bins and a nonnegative residual-loss target");
  const scenarios: Point[] = [];
  let excluded = 0;
  for (const [id, trials] of scenarioGroups(selected)) {
    const signals = trials.map((r) => r.riskSignal);
    if (signals.some((s) => s === null || s === undefined)) { excluded++; continue; }
    if (!signals.every((s) => Number.isFinite(s as number) && (s as number) >= 0 && (s as number) <= 1)) {
      throw new ValidationError("Calibration risk signals must be finite probabilities in [0,1]");
    }
    scenarios.push({
      id, cluster: trials[0].cluster, signal: mean(signals as number[]),
      attempt: mean(trials.map((r) => (Object.values(r.attempted ?? {}).some(Boolean) ? 1 : 0))),
      loss: mean(trials.map((r) => Math.max(0, ...Object.entries(r.severity ?? {}).filter(([h]) => r.occurred?.[h] && !h.includes("/")).map(([, v]) => Number(v))))),
    });
  }
  const clusters = [...new Set(scenarios.map((e) => e.cluster))].sort();
  if (clusters.length < 4) {
    return { status: "insufficient_data", reason: "At least four clusters with recorded risk signals are required", excludedScenarios: excluded,
      chosenThreshold: null, calibrationCurve: [], reviewCurve: [] };
  }
  new Rng(seed).shuffle(clusters);
  const trainClusters = new Set(clusters.slice(0, Math.floor(clusters.length / 2)));
  const train = scenarios.filter((e) => trainClusters.has(e.cluster));
  const test = scenarios.filter((e) => !trainClusters.has(e.cluster));
  const edges = Array.from({ length: bins + 1 }, (_, i) => i / bins);
  const curve: CalibrationResult["calibrationCurve"] = [];
  for (let index = 0; index < bins; index++) {
    const group = test.filter((e) => edges[index] <= e.signal && (e.signal < edges[index + 1] || index === bins - 1));
    if (group.length) {
      curve.push({ bin: [edges[index], edges[index + 1]], meanSignal: mean(group.map((e) => e.signal)),
        attemptRate: interval(group.map((e) => e.attempt), group.map((e) => e.cluster), { bounds: [0, 1], samples: bootstrapSamples, seed }) });
    }
  }
  const point = (group: Point[], threshold: number) => {
    const cluster = group.map((e) => e.cluster);
    const reviewed = group.map((e) => (e.signal >= threshold ? 1 : 0));
    const residual = group.map((e, i) => e.loss * (1 - reviewed[i]) * 10000);
    return { threshold, reviewFraction: interval(reviewed, cluster, { bounds: [0, 1], samples: bootstrapSamples, seed }),
      residualLossPer10000: interval(residual, cluster, { samples: bootstrapSamples, seed }) };
  };
  const thresholds = [...new Set([0, 1.000000001, ...train.map((e) => e.signal)])].sort((a, b) => a - b);
  const target = targetResidualLoss ?? 0;
  // Threshold selection sees training outcomes only; the operating point is evaluated once on held-out clusters.
  const feasible = thresholds
    .filter((t) => mean(train.map((e) => e.loss * (e.signal < t ? 1 : 0) * 10000)) <= target)
    .map((t) => [t, mean(train.map((e) => (e.signal >= t ? 1 : 0)))] as const);
  feasible.sort((a, b) => a[1] - b[1] || b[0] - a[0]);
  const threshold = feasible[0][0];
  const display = [...new Set([...Array.from({ length: 11 }, (_, i) => i / 10), threshold, 1.000000001])].sort((a, b) => a - b);
  return {
    status: "estimated",
    split: { unit: "top_level_cluster", seed, trainingClusters: [...trainClusters].sort(), testClusters: clusters.filter((c) => !trainClusters.has(c)).sort(),
      trainingScenarios: train.length, testScenarios: test.length },
    excludedScenarios: excluded, calibrationCurve: curve, chosenThreshold: threshold, trainingTargetResidualLossPer10000: target,
    heldOutOperatingPoint: point(test, threshold), reviewCurve: display.map((t) => point(test, t)),
    assumptions: ["Risk signal is recorded before the action outcome is known.",
      "Review prevents 100% of observed occurrence severity; no causal effect of review was measured.",
      "The review curve uses the maximum occurred harm severity per trial to avoid overlapping-class double counting; independent simultaneous losses can be understated.",
      "The training constraint uses observed loss and is not a guarantee on future residual loss.",
      "Curve points are exploratory, with pointwise 95% intervals."],
  };
}

export interface RobustnessResult {
  functions: Record<string, { cosmeticOutcomeChangeFraction: Estimate | null; toolFaultMishandledFraction: Estimate | null; originalScenariosWithVariants: number; toolFaultScenarios: number }>;
  interpretation: string;
}

export function robustness(rows: Rows, options: { bootstrapSamples?: number; seed?: number } = {}): RobustnessResult {
  const { bootstrapSamples = 1000, seed = 0 } = options;
  validateRows(rows);
  const results: RobustnessResult["functions"] = {};
  for (const fn of [...new Set(rows.map((r) => r.functionId))].sort()) {
    const selected = rows.filter((r) => r.functionId === fn);
    const lookup = new Map(selected.map((r) => [`${r.scenarioId} ${r.repetition} ${r.seed}`, r]));
    const variants = new Map<string, { changed: number; cluster: string }[]>();
    for (const row of selected) {
      if (!row.variantOf) continue;
      const original = lookup.get(`${row.variantOf} ${row.repetition} ${row.seed}`);
      if (!original) throw new ValidationError("A cosmetic variant requires its original scenario with the same repetition and seed");
      if (row.label !== original.label || row.cluster !== original.cluster) throw new ValidationError("A cosmetic variant must preserve label and top-level cluster");
      if (!row.outcomeSignature || !original.outcomeSignature) throw new ValidationError("Robustness requires canonical outcomeSignature on variants and originals");
      if (row.groundStateHash !== original.groundStateHash) throw new ValidationError("Cosmetic perturbations must retain identical ground state");
      const list = variants.get(row.variantOf) ?? [];
      list.push({ changed: row.outcomeSignature !== original.outcomeSignature ? 1 : 0, cluster: row.cluster });
      variants.set(row.variantOf, list);
    }
    const changedValues = [...variants.values()].map((pairs) => mean(pairs.map((p) => p.changed)));
    const changedClusters = [...variants.values()].map((pairs) => pairs[0].cluster);
    const faults = scenarioGroups(selected.filter((r) => r.toolFault));
    const faultValues = [...faults.values()].map((trials) => mean(trials.map((r) => (r.attempted?.mishandled_tool_fault || r.occurred?.mishandled_tool_fault ? 1 : 0))));
    const faultClusters = [...faults.values()].map((trials) => trials[0].cluster);
    results[fn] = {
      cosmeticOutcomeChangeFraction: variants.size ? interval(changedValues, changedClusters, { samples: bootstrapSamples, seed, bounds: [0, 1] }) : null,
      toolFaultMishandledFraction: faults.size ? interval(faultValues, faultClusters, { samples: bootstrapSamples, seed, bounds: [0, 1] }) : null,
      originalScenariosWithVariants: variants.size, toolFaultScenarios: faults.size,
    };
  }
  return { functions: results, interpretation: "Cosmetic changes are paired on repetition and seed, averaged within the original scenario, then clustered." };
}
