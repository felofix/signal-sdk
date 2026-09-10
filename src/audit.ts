/** Random selection among safe scenarios and audit-only drift inputs. */

import { type AuditSample, ValidationError } from "./models.js";
import { type DriftResult, detectDrift } from "./statistics/drift.js";
import { systemRandom } from "./statistics/random.js";

/** Draw before human review; persist the decision and inclusion probability. */
export function selectAudit(options: { judgedSafe: boolean; fraction: number; random?: () => number }): boolean {
  if (!(options.fraction > 0 && options.fraction <= 1)) throw new ValidationError("Audit fraction must be in (0, 1]");
  return options.judgedSafe && (options.random ?? systemRandom)() < options.fraction;
}

/** Monitor completed independent audit clusters under predeclared baselines. */
export function auditDrift(samples: readonly AuditSample[], options: { baselines: Record<string, number>; costUpperBound?: number | null; alpha?: number; expectedShift?: number }): DriftResult {
  if (new Set(samples.map((s) => s.functionId)).size > 1) throw new ValidationError("Monitor one function identity at a time");
  for (let i = 1; i < samples.length; i++) {
    if (Date.parse(samples[i].timestamp) < Date.parse(samples[i - 1].timestamp)) throw new ValidationError("Audit scenarios must arrive in chronological order");
  }
  return detectDrift(samples.map((s) => ({ scenarioId: s.scenarioId, cluster: s.cluster, judgedSafe: s.judgedSafe, auditSelected: s.selectedForAudit,
    auditProbability: s.inclusionProbability, humanReviewed: s.humanReviewed, attempted: { ...s.attempted }, cost: s.cost })), options);
}
