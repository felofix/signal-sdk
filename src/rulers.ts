/**
 * Rulers: how performance is measured.
 *
 * A grader judges one trial. A ruler turns the rows of many trials into one
 * estimate with a 95% interval: accuracy, a cost, pass^k, agreement between
 * raters. Rulers are the vocabulary of an experiment; certificates use them too.
 */

import { ValidationError } from "./models.js";
import { type Estimate, type Row, type Rows, estimateMetric, interval, scenarioGroups } from "./statistics/core.js";
import { mean, quantile } from "./statistics/dist.js";
import { Rng } from "./statistics/random.js";

export type RulerResult = Partial<Estimate> & { estimate: number | null; interval: [number | null, number | null]; ruler?: string; [extra: string]: unknown };
export type Measure = (rows: Rows, bootstrapSamples: number, seed: number) => RulerResult;

export class Ruler {
  readonly name: string;
  readonly measure: Measure;
  readonly description: string;
  readonly metric: string | null;
  readonly higherIsBetter: boolean | null;

  constructor(name: string, measure: Measure, options: { description?: string; metric?: string | null; higherIsBetter?: boolean | null } = {}) {
    this.name = name;
    this.measure = measure;
    this.description = options.description ?? "";
    this.metric = options.metric ?? null;
    this.higherIsBetter = options.higherIsBetter ?? null;
    Object.freeze(this);
  }

  apply(rows: Rows, options: { bootstrapSamples?: number; seed?: number } = {}): RulerResult {
    const result = { ...this.measure(rows, options.bootstrapSamples ?? 2000, options.seed ?? 0) };
    result.ruler ??= this.name;
    return result;
  }
}

const LOWER_IS_BETTER = new Set(["cost", "latencyMs", "tokens", "steps", "retries"]);

/**
 * Scenario-weighted mean of a row metric with a top-cluster bootstrap interval.
 * Metrics: correct, fieldF1, schemaValid, cost, latencyMs, tokens, steps, retries,
 * attempts:<harm>, occurrences:<harm>, loss:<harm>, metric:<name>.
 */
export function rate(metric: string, options: { name?: string; higherIsBetter?: boolean | null; description?: string } = {}): Ruler {
  let higher = options.higherIsBetter;
  if (higher === undefined) {
    higher = ["correct", "fieldF1", "schemaValid"].includes(metric) ? true : null;
    if (LOWER_IS_BETTER.has(metric) || metric.startsWith("attempts:") || metric.startsWith("occurrences:") || metric.startsWith("loss:")) higher = false;
  }
  return new Ruler(options.name ?? metric, (rows, samples, seed) => estimateMetric(rows, metric, { samples, seed }),
    { description: options.description ?? `Mean ${metric} per scenario, 95% cluster interval`, metric, higherIsBetter: higher });
}

export function accuracy(): Ruler {
  return rate("correct", { name: "accuracy", description: "Fraction of scenarios with the correct final state" });
}

function perScenario(rows: Rows, statistic: (trials: Row[]) => number, samples: number, seed: number): Estimate {
  const groups = [...scenarioGroups(rows).values()];
  return interval(groups.map(statistic), groups.map((trials) => trials[0].cluster), { samples, seed, bounds: [0, 1] });
}

export function passPowerK(): Ruler {
  return new Ruler("pass^k", (rows, s, seed) => perScenario(rows, (trials) => (trials.every((r) => r.correct) ? 1 : 0), s, seed),
    { description: "Fraction of scenarios where every repetition is correct", higherIsBetter: true });
}

export function pathConsistency(): Ruler {
  return new Ruler("path_consistency", (rows, s, seed) => perScenario(rows, (trials) => (new Set(trials.map((r) => r.pathSignature)).size === 1 ? 1 : 0), s, seed),
    { description: "Fraction of scenarios whose repetitions took the identical tool-call path", higherIsBetter: true });
}

/** Nominal Krippendorff's alpha over units, each a list of ratings from different raters. */
export function krippendorffAlpha(units: readonly (readonly string[])[]): number | null {
  const pairable = units.filter((u) => u.length >= 2);
  const n = pairable.reduce((sum, u) => sum + u.length, 0);
  if (n < 2) return null;
  const totals = new Map<string, number>();
  for (const unit of pairable) for (const v of unit) totals.set(v, (totals.get(v) ?? 0) + 1);
  let observed = 0;
  for (const unit of pairable) {
    const counts = new Map<string, number>();
    for (const v of unit) counts.set(v, (counts.get(v) ?? 0) + 1);
    let disagreements = 0;
    for (const [c, nc] of counts) for (const [k, nk] of counts) if (c !== k) disagreements += nc * nk;
    observed += disagreements / (unit.length - 1);
  }
  observed /= n;
  let expected = 0;
  for (const [c, nc] of totals) for (const [k, nk] of totals) if (c !== k) expected += nc * nk;
  expected /= n * (n - 1);
  if (expected === 0) return observed === 0 ? 1 : null;
  return 1 - observed / expected;
}

function clusterBootstrap(rows: Rows, statistic: (rows: Rows) => number | null, samples: number, seed: number, bounds: [number, number] | null): RulerResult {
  const estimate = statistic(rows);
  const byCluster = new Map<string, Row[]>();
  for (const row of rows) { const list = byCluster.get(row.cluster) ?? []; list.push(row); byCluster.set(row.cluster, list); }
  const names = [...byCluster.keys()].sort();
  const result: RulerResult = { estimate, interval: [null, null], confidence: 0.95, clusters: names.length, scenarios: scenarioGroups(rows).size,
    method: "top_cluster_bootstrap_percentile" };
  if (estimate === null || names.length < 2) { result.method = "not_estimable; need the statistic and at least two clusters"; return result; }
  const rng = new Rng(seed);
  const draws: number[] = [];
  for (let s = 0; s < samples; s++) {
    const chosen: Row[] = [];
    for (let k = 0; k < names.length; k++) chosen.push(...byCluster.get(names[rng.integer(0, names.length)])!);
    const value = statistic(chosen);
    if (value !== null) draws.push(value);
  }
  if (draws.length < samples / 2) { result.method = "not_estimable; statistic undefined in most resamples"; return result; }
  let low = quantile(draws, 0.025), high = quantile(draws, 0.975);
  if (bounds) { low = Math.max(bounds[0], low); high = Math.min(bounds[1], high); }
  result.interval = [low, high];
  return result;
}

/**
 * Krippendorff's alpha between named raters found in each trial's ratings.
 * Raters may be a deterministic grader, humans, or a language-model judge run
 * over the transcripts afterwards. Low agreement means the judge is not yet a ruler.
 */
export function interRaterReliability(raters: readonly string[]): Ruler {
  if (raters.length < 2) throw new ValidationError("Inter-rater reliability needs at least two raters");
  const statistic = (rows: Rows) => krippendorffAlpha(rows.map((r) => raters.filter((name) => name in (r.ratings ?? {})).map((name) => String(r.ratings[name]))));
  return new Ruler(`irr:${raters.join("+")}`, (rows, s, seed) => clusterBootstrap(rows, statistic, s, seed, [-1, 1]),
    { description: `Nominal Krippendorff's alpha between raters ${raters.join(", ")}`, higherIsBetter: true });
}

/** Fraction of trials where a rater's verdict (truthy = correct) matches the deterministic grader. */
export function agreementWithGrader(rater: string): Ruler {
  const statistic = (trials: Row[]) => {
    const judged = trials.filter((r) => rater in (r.ratings ?? {})).map((r) => (Boolean(r.ratings[rater]) === r.correct ? 1 : 0));
    return judged.length ? mean(judged) : NaN;
  };
  return new Ruler(`agreement:${rater}`, (rows, s, seed) => {
    const rated = rows.filter((r) => rater in (r.ratings ?? {}));
    if (!rated.length) return { estimate: null, interval: [null, null], method: "not_estimable; no ratings from this rater" };
    return perScenario(rated, statistic, s, seed);
  }, { description: `Agreement between rater ${rater} and the deterministic outcome grader`, higherIsBetter: true });
}

export const DEFAULT_RULERS: readonly Ruler[] = Object.freeze([accuracy(), rate("fieldF1"), passPowerK(), pathConsistency(), rate("cost"), rate("latencyMs"), rate("steps")]);

export function applyRulers(rows: Rows, rulers: readonly Ruler[], options: { functionId: string; bootstrapSamples?: number; seed?: number }): Record<string, RulerResult> {
  const selected = rows.filter((r) => r.functionId === options.functionId);
  if (!selected.length) throw new ValidationError(`No observations for function ${options.functionId}`);
  return Object.fromEntries(rulers.map((ruler) => [ruler.name, ruler.apply(selected, options)]));
}
