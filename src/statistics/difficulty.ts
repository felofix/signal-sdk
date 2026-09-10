/**
 * Logistic mixed effects for scenario difficulty and new-book prediction.
 *
 * correct ~ function × label + (1|cluster) + (1|scenario) + (1|scenario:function)
 *
 * Fitted in-repo with a Laplace approximation: penalised Newton for the
 * coefficients given the variance components, Nelder–Mead on the Laplace
 * marginal for the three log standard deviations. Priors match the previous
 * implementation: fixed effects N(0, 2²), log random-effect sd N(0, 0.5²).
 */

import { ValidationError } from "../models.js";
import { type Rows, validateRows } from "./core.js";
import { expit, mean, quantile, variance } from "./dist.js";
import { type Matrix, cholesky, logDeterminantFromCholesky, solveUpperTransposed, solveWithCholesky, zeros } from "./linalg.js";
import { Rng } from "./random.js";

interface Design {
  n: number; p: number; names: string[]; x: Float64Array; y: Float64Array;
  cluster: Int32Array; traj: Int32Array; cell: Int32Array; counts: [number, number, number];
  functions: string[]; labels: string[]; scenarios: string[]; rowFunction: string[]; rowLabel: string[]; rowScenario: string[];
}

interface Fit { w: Float64Array; l: Matrix; logPosterior: number; laplace: number; theta: [number, number, number] }

const FIXED_PRIOR_PRECISION = 1 / 4;
const LOG_SD_PRIOR_SD = 0.5;
const MAX_PARAMETERS = 2500;

function buildDesign(rows: Rows): Design {
  const functions = [...new Set(rows.map((r) => r.functionId))].sort();
  const labels = [...new Set(rows.map((r) => r.label))].sort();
  const scenarios = [...new Set(rows.map((r) => r.scenarioId))].sort();
  const clusters = [...new Set(rows.map((r) => r.cluster))].sort();
  const cells = [...new Set(rows.map((r) => `${r.scenarioId}::${r.functionId}`))].sort();
  const names = ["intercept", ...functions.slice(1).map((f) => `function[${f}]`), ...labels.slice(1).map((l) => `label[${l}]`)];
  for (const f of functions.slice(1)) for (const l of labels.slice(1)) names.push(`function[${f}]:label[${l}]`);
  const p = names.length;
  const n = rows.length;
  const x = new Float64Array(n * p);
  const y = new Float64Array(n);
  const cluster = new Int32Array(n), traj = new Int32Array(n), cell = new Int32Array(n);
  const fIndex = new Map(functions.map((f, i) => [f, i])), lIndex = new Map(labels.map((l, i) => [l, i]));
  const tIndex = new Map(scenarios.map((t, i) => [t, i])), cIndex = new Map(clusters.map((c, i) => [c, i])), kIndex = new Map(cells.map((c, i) => [c, i]));
  rows.forEach((row, i) => {
    y[i] = row.correct ? 1 : 0;
    const fi = fIndex.get(row.functionId)!, li = lIndex.get(row.label)!;
    x[i * p] = 1;
    if (fi > 0) x[i * p + fi] = 1;
    if (li > 0) x[i * p + functions.length - 1 + li] = 1;
    if (fi > 0 && li > 0) x[i * p + functions.length - 1 + labels.length - 1 + (fi - 1) * (labels.length - 1) + (li - 1)] = 1;
    cluster[i] = cIndex.get(row.cluster)!; traj[i] = tIndex.get(row.scenarioId)!; cell[i] = kIndex.get(`${row.scenarioId}::${row.functionId}`)!;
  });
  return { n, p, names, x, y, cluster, traj, cell, counts: [clusters.length, scenarios.length, cells.length], functions, labels, scenarios,
    rowFunction: rows.map((r) => r.functionId), rowLabel: rows.map((r) => r.label), rowScenario: rows.map((r) => r.scenarioId) };
}

function offsets(d: Design): [number, number, number] {
  return [d.p, d.p + d.counts[0], d.p + d.counts[0] + d.counts[1]];
}

function linearPredictor(d: Design, w: Float64Array): Float64Array {
  const [oc, ot, ok] = offsets(d);
  const eta = new Float64Array(d.n);
  for (let i = 0; i < d.n; i++) {
    let v = 0;
    for (let j = 0; j < d.p; j++) v += d.x[i * d.p + j] * w[j];
    eta[i] = v + w[oc + d.cluster[i]] + w[ot + d.traj[i]] + w[ok + d.cell[i]];
  }
  return eta;
}

function precisionVector(d: Design, theta: [number, number, number]): Float64Array {
  const size = d.p + d.counts[0] + d.counts[1] + d.counts[2];
  const prec = new Float64Array(size);
  const [oc, ot, ok] = offsets(d);
  for (let j = 0; j < d.p; j++) prec[j] = FIXED_PRIOR_PRECISION;
  for (let j = oc; j < ot; j++) prec[j] = Math.exp(-2 * theta[0]);
  for (let j = ot; j < ok; j++) prec[j] = Math.exp(-2 * theta[1]);
  for (let j = ok; j < size; j++) prec[j] = Math.exp(-2 * theta[2]);
  return prec;
}

function objective(d: Design, w: Float64Array, prec: Float64Array): number {
  const eta = linearPredictor(d, w);
  let value = 0;
  for (let i = 0; i < d.n; i++) {
    const mu = expit(eta[i]);
    value += d.y[i] * Math.log(Math.max(mu, 1e-300)) + (1 - d.y[i]) * Math.log(Math.max(1 - mu, 1e-300));
  }
  for (let j = 0; j < w.length; j++) value -= 0.5 * prec[j] * w[j] * w[j];
  return value;
}

function hessian(d: Design, w: Float64Array, prec: Float64Array): { h: Matrix; grad: Float64Array } {
  const size = w.length;
  const [oc, ot, ok] = offsets(d);
  const h = zeros(size, size);
  const grad = new Float64Array(size);
  const eta = linearPredictor(d, w);
  for (let i = 0; i < d.n; i++) {
    const mu = expit(eta[i]);
    const weight = Math.max(mu * (1 - mu), 1e-10);
    const residual = d.y[i] - mu;
    const idx = [oc + d.cluster[i], ot + d.traj[i], ok + d.cell[i]];
    const base = i * d.p;
    for (let a = 0; a < d.p; a++) {
      const xa = d.x[base + a];
      if (xa === 0) continue;
      grad[a] += residual * xa;
      for (let b = 0; b < d.p; b++) h.data[a * size + b] += weight * xa * d.x[base + b];
      for (const j of idx) { h.data[a * size + j] += weight * xa; h.data[j * size + a] += weight * xa; }
    }
    for (const j of idx) {
      grad[j] += residual;
      for (const k of idx) h.data[j * size + k] += weight;
    }
  }
  for (let j = 0; j < size; j++) { grad[j] -= prec[j] * w[j]; h.data[j * size + j] += prec[j]; }
  return { h, grad };
}

function newton(d: Design, theta: [number, number, number], start?: Float64Array): Fit {
  const prec = precisionVector(d, theta);
  let w = start && start.length === prec.length ? Float64Array.from(start) : new Float64Array(prec.length);
  let current = objective(d, w, prec);
  let l: Matrix | null = null;
  for (let iteration = 0; iteration < 60; iteration++) {
    const { h, grad } = hessian(d, w, prec);
    l = cholesky(h);
    const step = solveWithCholesky(l, grad);
    let scale = 1;
    let candidate = w, value = -Infinity;
    for (let halving = 0; halving < 12; halving++) {
      candidate = w.map((v, j) => v + scale * step[j]);
      value = objective(d, candidate, prec);
      if (value >= current - 1e-12) break;
      scale /= 2;
    }
    const change = Math.max(...step.map((s) => Math.abs(s * scale)));
    w = candidate;
    current = value;
    if (change < 1e-6) break;
  }
  const { h } = hessian(d, w, prec);
  l = cholesky(h);
  const [oc] = offsets(d);
  let logPrior = 0;
  for (let j = oc; j < prec.length; j++) logPrior += 0.5 * Math.log(prec[j]);
  const thetaPrior = theta.reduce((s, t) => s - (t * t) / (2 * LOG_SD_PRIOR_SD ** 2), 0);
  const laplace = current + logPrior - 0.5 * logDeterminantFromCholesky(l) + thetaPrior;
  if (!Number.isFinite(laplace) || w.some((v) => !Number.isFinite(v))) throw new RangeError("Mixed model did not converge; increase the book or inspect the design");
  return { w, l, logPosterior: current, laplace, theta };
}

/** Nelder–Mead on the three log standard deviations. */
function optimise(d: Design, start: [number, number, number], maxEvaluations: number): Fit {
  let warm: Float64Array | undefined;
  const evaluate = (theta: [number, number, number]): Fit => {
    const clipped = theta.map((t) => Math.max(-4, Math.min(3, t))) as [number, number, number];
    const fit = newton(d, clipped, warm);
    warm = fit.w;
    return fit;
  };
  let simplex: { theta: [number, number, number]; fit: Fit }[] = [start, [start[0] + 0.5, start[1], start[2]], [start[0], start[1] + 0.5, start[2]], [start[0], start[1], start[2] + 0.5]]
    .map((theta) => ({ theta: theta as [number, number, number], fit: evaluate(theta as [number, number, number]) }));
  let evaluations = 4;
  const value = (s: { fit: Fit }) => -s.fit.laplace;
  while (evaluations < maxEvaluations) {
    simplex.sort((a, b) => value(a) - value(b));
    if (Math.abs(value(simplex[3]) - value(simplex[0])) < 1e-3) break;
    const centroid = [0, 1, 2].map((k) => (simplex[0].theta[k] + simplex[1].theta[k] + simplex[2].theta[k]) / 3) as [number, number, number];
    const worst = simplex[3];
    const reflect = centroid.map((c, k) => c + (c - worst.theta[k])) as [number, number, number];
    const reflected = { theta: reflect, fit: evaluate(reflect) }; evaluations++;
    if (value(reflected) < value(simplex[0])) {
      const expand = centroid.map((c, k) => c + 2 * (c - worst.theta[k])) as [number, number, number];
      const expanded = { theta: expand, fit: evaluate(expand) }; evaluations++;
      simplex[3] = value(expanded) < value(reflected) ? expanded : reflected;
    } else if (value(reflected) < value(simplex[2])) {
      simplex[3] = reflected;
    } else {
      const contract = centroid.map((c, k) => c + 0.5 * (worst.theta[k] - c)) as [number, number, number];
      const contracted = { theta: contract, fit: evaluate(contract) }; evaluations++;
      if (value(contracted) < value(worst)) simplex[3] = contracted;
      else {
        simplex = simplex.map((s, i) => i === 0 ? s : { theta: s.theta.map((t, k) => simplex[0].theta[k] + 0.5 * (t - simplex[0].theta[k])) as [number, number, number], fit: s.fit });
        for (let i = 1; i < 4; i++) { simplex[i].fit = evaluate(simplex[i].theta); evaluations++; }
      }
    }
  }
  simplex.sort((a, b) => value(a) - value(b));
  return simplex[0].fit;
}

function thetaSd(d: Design, fit: Fit): [number, number, number] {
  const h = 0.15;
  const sd = fit.theta.map((t, k) => {
    const plus = [...fit.theta] as [number, number, number]; plus[k] = t + h;
    const minus = [...fit.theta] as [number, number, number]; minus[k] = t - h;
    const second = (newton(d, plus, fit.w).laplace - 2 * fit.laplace + newton(d, minus, fit.w).laplace) / (h * h);
    return Math.min(1.5, 1 / Math.sqrt(Math.max(-second, 1e-3)));
  });
  return sd as [number, number, number];
}

/** Joint draws from N(ŵ, H⁻¹) using the Cholesky factor of the posterior precision. */
function jointDraws(fit: Fit, draws: number, rng: Rng): Float64Array[] {
  const size = fit.w.length;
  const out: Float64Array[] = [];
  for (let s = 0; s < draws; s++) {
    const z = rng.normals(size);
    const perturbation = solveUpperTransposed(fit.l, z);
    out.push(fit.w.map((v, j) => v + perturbation[j]));
  }
  return out;
}

function posteriorInterval(values: ArrayLike<number>): [number, number] {
  return [quantile(values, 0.025), quantile(values, 0.975)];
}

export interface DifficultyResult {
  status: "estimated" | "insufficient_data" | "not_estimable"; reason?: string;
  empiricalDifficulty: Record<string, { status: string; reason?: string; excludedFunctionId?: string; trainingFunctionIds?: string[]; scenarios?: Record<string, number>; scenarioIntervals?: Record<string, [number, number]>; interpretation?: string }>;
  predictions: Record<string, { observedBookExpectedCorrectRate: { estimate: number; interval: [number, number] }; nextBookCorrectRate: { estimate: number; interval: [number, number] };
    nextBookCorrectCount: { estimate: number; interval: [number, number] }; predictionWiderThanMeasuredInterval: boolean; status: string }>;
  [extra: string]: unknown;
}

export function difficulty(rows: Rows, options: { seed?: number; futureScenarios?: number; draws?: number } = {}): DifficultyResult {
  const { seed = 0, futureScenarios = 10000, draws = 1000 } = options;
  validateRows(rows);
  if (futureScenarios < 1 || draws < 100) throw new ValidationError("A positive horizon and at least 100 posterior draws are required");
  const design = buildDesign(rows);
  if (design.scenarios.length < 12 || design.functions.length < 2 || design.counts[0] < 4) {
    return { status: "insufficient_data", reason: "Need 12 scenarios, two functions and four clusters", empiricalDifficulty: {}, predictions: {} };
  }
  if (design.p + design.counts[0] + design.counts[1] + design.counts[2] > MAX_PARAMETERS) {
    return { status: "not_estimable", reason: `The dense Laplace model is limited to ${MAX_PARAMETERS} coefficients`, empiricalDifficulty: {}, predictions: {} };
  }
  let fit: Fit;
  try {
    fit = optimise(design, [0, 0, 0], 80);
  } catch (error) {
    return { status: "not_estimable", reason: (error as Error).message, empiricalDifficulty: {}, predictions: {} };
  }
  const rng = new Rng(seed);
  const joint = jointDraws(fit, draws, rng);
  const sd = thetaSd(design, fit);
  const variances = joint.map(() => fit.theta.map((t, k) => Math.exp(2 * rng.normal(t, sd[k]))) as [number, number, number]);
  const groupNames = ["cluster", "scenario", "scenario_function"];
  const meanVariances = Object.fromEntries(groupNames.map((name, k) => [name, Math.exp(2 * fit.theta[k])]));

  const empirical: DifficultyResult["empiricalDifficulty"] = {};
  for (const functionId of design.functions) {
    const trainingRows = rows.filter((r) => r.functionId !== functionId);
    const training = buildDesign(trainingRows);
    let without: Fit;
    try {
      without = optimise(training, fit.theta, 25);
    } catch (error) {
      empirical[functionId] = { status: "not_estimable", reason: (error as Error).message };
      continue;
    }
    const eta = linearPredictor(training, without.w);
    const failure = new Map<string, number[]>();
    training.rowScenario.forEach((t, i) => { const list = failure.get(t) ?? []; list.push(1 - expit(eta[i])); failure.set(t, list); });
    const leaveDraws = jointDraws(without, draws, rng);
    const intervals: Record<string, [number, number]> = {};
    for (const scenario of training.scenarios) {
      const indices = training.rowScenario.map((t, i) => (t === scenario ? i : -1)).filter((i) => i >= 0);
      const perDraw = leaveDraws.map((w) => { const e = linearPredictor(training, w); return mean(indices.map((i) => 1 - expit(e[i]))); });
      intervals[scenario] = posteriorInterval(perDraw);
    }
    empirical[functionId] = {
      status: "estimated", excludedFunctionId: functionId, trainingFunctionIds: training.functions,
      scenarios: Object.fromEntries([...failure.entries()].map(([t, v]) => [t, mean(v)])), scenarioIntervals: intervals,
      interpretation: "Predicted failure on the other measured functions; the assessed function's trials were excluded before fitting.",
    };
  }

  const fixedDraws = joint.map((w) => w.subarray(0, design.p));
  const fittedFixed = Array.from({ length: design.n }, (_, i) => { let v = 0; for (let j = 0; j < design.p; j++) v += design.x[i * design.p + j] * fit.w[j]; return v; });
  const labelMeans = new Map<string, number>();
  for (const label of design.labels) labelMeans.set(label, mean(fittedFixed.filter((_, i) => design.rowLabel[i] === label)));
  const labelVariance = variance(design.rowLabel.map((l) => labelMeans.get(l)!));
  const denominator = labelVariance + Object.values(meanVariances).reduce((a, b) => a + b, 0) + Math.PI ** 2 / 3;
  const labelDesign = new Map<string, Float64Array>();
  for (const label of design.labels) {
    const indices = design.rowLabel.map((l, i) => (l === label ? i : -1)).filter((i) => i >= 0);
    const row = new Float64Array(design.p);
    for (const i of indices) for (let j = 0; j < design.p; j++) row[j] += design.x[i * design.p + j] / indices.length;
    labelDesign.set(label, row);
  }
  const labelFractionDraws = fixedDraws.map((beta, s) => {
    const values = design.rowLabel.map((l) => { const row = labelDesign.get(l)!; let v = 0; for (let j = 0; j < design.p; j++) v += row[j] * beta[j]; return v; });
    const v = variance(values);
    return v / (v + variances[s].reduce((a, b) => a + b, 0) + Math.PI ** 2 / 3);
  });

  const predictions: DifficultyResult["predictions"] = {};
  const rates: Record<string, Record<string, { estimate: number; interval: [number, number] }>> = {};
  const clusterSize = Math.max(1, Math.round(design.scenarios.length / design.counts[0]));
  const seen = new Set<string>();
  const observedIndices = design.rowFunction.map((f, i) => { const key = `${design.rowScenario[i]}::${f}`; if (seen.has(key)) return -1; seen.add(key); return i; }).filter((i) => i >= 0);
  for (const functionId of design.functions) {
    const indices = observedIndices.filter((i) => design.rowFunction[i] === functionId);
    const finiteMean = joint.map((w) => { const eta = linearPredictor(design, w); return mean(indices.map((i) => expit(eta[i]))); });
    const futureRates = new Float64Array(draws);
    for (let s = 0; s < draws; s++) {
      const beta = fixedDraws[s];
      const linearBase = indices.map((i) => { let v = 0; for (let j = 0; j < design.p; j++) v += design.x[i * design.p + j] * beta[j]; return v; });
      const newClusters = Math.ceil(futureScenarios / clusterSize);
      const clusterEffects = rng.normals(newClusters, 0, Math.sqrt(variances[s][0]));
      const residualSd = Math.sqrt(variances[s][1] + variances[s][2]);
      let correct = 0;
      for (let t = 0; t < futureScenarios; t++) {
        const linear = linearBase[rng.integer(0, linearBase.length)] + clusterEffects[Math.floor(t / clusterSize)] + rng.normal(0, residualSd);
        if (rng.next() < expit(linear)) correct++;
      }
      futureRates[s] = correct / futureScenarios;
    }
    const finiteInterval = posteriorInterval(finiteMean);
    const predictiveInterval = posteriorInterval(futureRates);
    const wider = predictiveInterval[1] - predictiveInterval[0] > finiteInterval[1] - finiteInterval[0];
    predictions[functionId] = {
      observedBookExpectedCorrectRate: { estimate: mean(finiteMean), interval: finiteInterval },
      nextBookCorrectRate: { estimate: mean(futureRates), interval: predictiveInterval },
      nextBookCorrectCount: { estimate: mean(futureRates) * futureScenarios, interval: [predictiveInterval[0] * futureScenarios, predictiveInterval[1] * futureScenarios] },
      predictionWiderThanMeasuredInterval: wider, status: wider ? "estimated" : "prediction_width_check_failed",
    };
    rates[functionId] = {};
    for (const label of design.labels) {
      const rowIndices = design.rowFunction.map((f, i) => (f === functionId && design.rowLabel[i] === label ? i : -1)).filter((i) => i >= 0);
      if (!rowIndices.length) continue;
      const xLabel = new Float64Array(design.p);
      for (const i of rowIndices) for (let j = 0; j < design.p; j++) xLabel[j] += design.x[i * design.p + j] / rowIndices.length;
      const probabilities = fixedDraws.map((beta) => { let v = 0; for (let j = 0; j < design.p; j++) v += xLabel[j] * beta[j]; return expit(v); });
      rates[functionId][label] = { estimate: mean(probabilities), interval: posteriorInterval(probabilities) };
    }
  }
  return {
    status: "estimated", method: "Bayesian binomial mixed model; Laplace approximation with Nelder–Mead on variance components and joint conditional coefficient covariance",
    formula: "correct ~ function * label + (1|cluster) + (1|scenario) + (1|scenario:function)",
    intervalKind: "95% approximate posterior credible/predictive intervals, not frequentist confidence intervals",
    priors: { fixedEffectNormalSd: 2, logRandomEffectSdNormalSd: LOG_SD_PRIOR_SD },
    fixedEffects: Object.fromEntries(design.names.map((name, j) => [name, { estimate: fit.w[j], interval: posteriorInterval(fixedDraws.map((b) => b[j])) }])),
    varianceComponents: meanVariances, labelExplainedLatentFraction: labelVariance / denominator,
    labelExplainedLatentFractionInterval: posteriorInterval(labelFractionDraws),
    labelExplainedDefinition: "Variance of label-specific mean fixed log-odds / (that variance + random-effect variances + logistic residual variance)",
    functionByLabelCorrectProbabilityAtZeroRandomEffect: rates, empiricalDifficulty: empirical, predictions,
    futureScenarios, posteriorDraws: draws, futureClusterSizeAssumption: clusterSize,
    assumptions: ["Random intercepts are independent Gaussian components conditional on the fixed effects.",
      "The future book retains the observed label mixture and mean cluster size.",
      "Variance components are point-estimated by Laplace marginal likelihood with a numerical curvature for their uncertainty; coefficient covariance is conditional on them. This model is exploratory.",
      "No discrimination parameter is estimated.",
      "A failed prediction-width check is reported, never repaired by artificially widening an interval."],
  };
}
