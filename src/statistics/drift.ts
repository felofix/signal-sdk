/** Anytime-valid bounded-mean monitoring of randomly selected audit scenarios. */

import { ValidationError } from "../models.js";
import { mean } from "./dist.js";

export interface AuditRow {
  scenarioId: string; cluster: string; judgedSafe: boolean; auditSelected: boolean; auditProbability: number; humanReviewed: boolean;
  attempted?: Record<string, boolean>; occurred?: Record<string, boolean>; cost?: number | null;
}

export interface DriftResult {
  auditScenarios: number; auditClusters: number; familywiseAlpha: number; alarmThreshold: number; method: string; assumptions: string[];
  metrics: Record<string, { baseline: number; alarm: boolean; firstAlarmCluster: number | null; eValue: number; maximumEValue: number;
    trace: { cluster: string; scenarios: number; observedMean: number; logEValue: number }[] }>;
}

/**
 * A bounded Hoeffding e-process, applied once per completed top cluster.
 * Baseline keys: attempts:<harm>, occurrences:<harm>, or cost.
 */
export function detectDrift(auditRows: readonly AuditRow[], options: { baselines: Record<string, number>; alpha?: number; expectedShift?: number; costUpperBound?: number | null }): DriftResult {
  const { baselines, alpha = 0.05, expectedShift = 0.1, costUpperBound = null } = options;
  if (!(alpha > 0 && alpha < 1) || !(expectedShift > 0 && expectedShift <= 1) || !Object.keys(baselines).length) {
    throw new ValidationError("Specify baselines, alpha in (0,1), and normalized expectedShift in (0,1]");
  }
  if (auditRows.some((r) => !r.auditSelected || !r.judgedSafe || !r.humanReviewed)) {
    throw new ValidationError("Drift must use only randomly audited scenarios that operation judged safe");
  }
  const probabilities = new Set(auditRows.map((r) => Number(r.auditProbability ?? 0)));
  if (probabilities.size && (probabilities.size !== 1 || !((probabilities.values().next().value as number) > 0 && (probabilities.values().next().value as number) <= 1))) {
    throw new ValidationError("Audit rows require one common, positive random inclusion probability");
  }
  if (new Set(auditRows.map((r) => r.scenarioId)).size !== auditRows.length) throw new ValidationError("Operational audit scenarios may appear only once");
  const clustered = new Map<string, AuditRow[]>();
  const closed = new Set<string>();
  let previous: string | null = null;
  for (const row of auditRows) {
    if (previous !== null && row.cluster !== previous) closed.add(previous);
    if (closed.has(row.cluster)) throw new ValidationError("Completed audit clusters cannot be reopened");
    previous = row.cluster;
    const list = clustered.get(row.cluster) ?? [];
    list.push(row);
    clustered.set(row.cluster, list);
  }
  const threshold = Object.keys(baselines).length / alpha;
  const results: DriftResult["metrics"] = {};
  for (const [metric, baseline] of Object.entries(baselines)) {
    const upper = metric === "cost" ? Number(costUpperBound ?? 0) : 1;
    if (!(upper > 0) || !Number.isFinite(upper) || !Number.isFinite(baseline) || !(baseline >= 0 && baseline <= upper)) {
      throw new ValidationError("Baseline must be within finite bounds; cost requires a predeclared costUpperBound");
    }
    if (metric !== "cost" && !metric.startsWith("attempts:") && !metric.startsWith("occurrences:")) throw new ValidationError(`Unsupported audit drift metric: ${metric}`);
    const lambda = 4 * expectedShift;
    let logE = 0, maximum = 0;
    let alarm: number | null = null;
    const trace: DriftResult["metrics"][string]["trace"] = [];
    let index = 0;
    for (const [cluster, observations] of clustered) {
      index++;
      let values: number[];
      if (metric === "cost") {
        values = observations.map((r) => r.cost as number);
        if (values.some((v) => v === null || v === undefined || !Number.isFinite(v) || v < 0 || v > upper)) {
          throw new ValidationError("Every audited cost must be observed and within its predeclared bound");
        }
      } else {
        const [kind, harm] = [metric.slice(0, metric.indexOf(":")), metric.slice(metric.indexOf(":") + 1)];
        values = observations.map((r) => ((kind === "attempts" ? r.attempted : r.occurred)?.[harm] ? 1 : 0));
      }
      const m = mean(values) / upper;
      logE += lambda * (m - baseline / upper) - lambda ** 2 / 8;
      maximum = Math.max(maximum, logE);
      if (alarm === null && logE >= Math.log(threshold)) alarm = index;
      trace.push({ cluster, scenarios: observations.length, observedMean: m * upper, logEValue: logE });
    }
    results[metric] = { baseline, alarm: alarm !== null, firstAlarmCluster: alarm, eValue: Math.exp(Math.min(logE, 700)), maximumEValue: Math.exp(Math.min(maximum, 700)), trace };
  }
  return { auditScenarios: auditRows.length, auditClusters: clustered.size, metrics: results, familywiseAlpha: alpha, alarmThreshold: threshold,
    method: "one-sided bounded Hoeffding e-process with Bonferroni anytime threshold",
    assumptions: ["Audit inclusion is random and independent of outcomes among operationally safe scenarios.",
      "Each cluster is completed before it is added; future observations cannot be appended to an already monitored cluster.",
      "Under the null each next cluster's conditional mean is at most its predeclared baseline.",
      "The monitored population is the operationally safe book; escalated non-audit work is excluded.",
      "Clusters are equally weighted for drift; baselines must use the same cluster-level estimand."] };
}
