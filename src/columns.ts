/**
 * The two measurement columns, per threat: outcome (the top event) and mechanism (the causal chain).
 * Nothing here is summed across threats into a single figure; a population row is shown last, labelled by its mix.
 */

import type { ThreatSpec } from "./models.js";
import { type Estimate, type Row, type Rows, estimateMetric, interval, scenarioGroups } from "./statistics/core.js";
import { MECHANISMS } from "./mechanisms.js";

export interface OutcomeCell { n: number; trials: number; correct: Estimate; attemptedDeviation: Estimate; occurredDeviation: Estimate }
export interface OutcomeColumn {
  unit: string;
  rows: (OutcomeCell & { threat: string; barrier: string | null; goldActions: readonly string[]; byLabel: Record<string, OutcomeCell> })[];
  population: OutcomeCell & { mix: Record<string, number>; note: string };
  derived: { escalatedWhenImpossible: Estimate; unnecessaryEscalation: Estimate };
}

function cell(rows: Rows, samples: number, seed: number): OutcomeCell {
  const est = (metric: string) => estimateMetric(rows, metric, { samples, seed });
  return { n: scenarioGroups(rows).size, trials: rows.length, correct: est("correct"), attemptedDeviation: est("attempts:deviation"), occurredDeviation: est("occurrences:deviation") };
}

export function outcomeColumn(rows: Rows, threats: Readonly<Record<string, ThreatSpec>>, options: { bootstrapSamples?: number; seed?: number } = {}): OutcomeColumn {
  const { bootstrapSamples: samples = 2000, seed = 0 } = options;
  const names = [...new Set([...Object.keys(threats), ...rows.map((r) => r.threat)])].sort((a, b) => (a === "nominal" ? -1 : b === "nominal" ? 1 : a.localeCompare(b)));
  const scenarios = scenarioGroups(rows).size;
  const result: OutcomeColumn["rows"] = [];
  for (const threat of names) {
    const selected = rows.filter((r) => r.threat === threat);
    if (!selected.length) continue;
    const labels = [...new Set(selected.map((r) => r.label))].sort();
    result.push({ threat, barrier: threats[threat]?.barrier ?? null, goldActions: threats[threat]?.goldActions ?? [], ...cell(selected, samples, seed),
      byLabel: Object.fromEntries(labels.map((label) => [label, cell(selected.filter((r) => r.label === label), samples, seed)])) });
  }
  const mix = Object.fromEntries(result.map((r) => [r.threat, r.n / scenarios]));
  const impossible = rows.filter((r) => r.label === "impossible");
  const unnecessary = interval([...scenarioGroups(rows).values()].map((trials) => trials.filter((r) => r.deviation === "wrong_action" && r.action === "escalate" && r.goldAction !== "escalate").length / trials.length),
    [...scenarioGroups(rows).values()].map((t) => t[0].cluster), { samples, seed, bounds: [0, 1] });
  return {
    unit: "scenario; repetitions averaged within a scenario, intervals resample top-level clusters",
    rows: result,
    population: { ...cell(rows, samples, seed), mix, note: "Weighted by the population's threat mix printed here; not a property of any single threat." },
    derived: {
      escalatedWhenImpossible: impossible.length ? estimateMetric(impossible, "correct", { samples, seed })
        : { estimate: null, interval: [null, null], confidence: 0.95, scenarios: 0, clusters: 0, method: "no scenarios labelled impossible", zeroEventNote: null },
      unnecessaryEscalation: unnecessary,
    },
  };
}

export interface MechanismColumn {
  precedence: readonly string[];
  rows: { threat: string; wrongTrials: number; wrongScenarios: number; expectedMechanisms: readonly string[]; primary: Record<string, Estimate>; mandateAttempt: Estimate }[];
  note: string;
}

export function mechanismColumn(rows: Rows, threats: Readonly<Record<string, ThreatSpec>>, options: { bootstrapSamples?: number; seed?: number } = {}): MechanismColumn {
  const { bootstrapSamples: samples = 2000, seed = 0 } = options;
  const precedence = rows[0]?.mechanismPrecedence ?? [];
  const names = [...new Set([...Object.keys(threats), ...rows.map((r) => r.threat)])].sort((a, b) => (a === "nominal" ? -1 : b === "nominal" ? 1 : a.localeCompare(b)));
  const result: MechanismColumn["rows"] = [];
  for (const threat of names) {
    const selected = rows.filter((r) => r.threat === threat);
    if (!selected.length) continue;
    const wrong = selected.filter((r) => !r.correct);
    const groups = [...scenarioGroups(wrong).values()];
    const clusters = groups.map((t) => t[0].cluster);
    const primary: Record<string, Estimate> = {};
    for (const mechanism of MECHANISMS) {
      if (mechanism === "mandate_attempt") continue;
      primary[mechanism] = groups.length
        ? interval(groups.map((trials: Row[]) => trials.filter((r) => r.primaryMechanism === mechanism).length / trials.length), clusters, { samples, seed, bounds: [0, 1] })
        : { estimate: null, interval: [null, null], confidence: 0.95, scenarios: 0, clusters: 0, method: "no wrong outcomes on this threat", zeroEventNote: null };
    }
    result.push({ threat, wrongTrials: wrong.length, wrongScenarios: groups.length, expectedMechanisms: threats[threat]?.expectedMechanisms ?? [], primary,
      mandateAttempt: estimateMetric(selected, "attempts:mandate_attempt", { samples, seed }) });
  }
  return { precedence, rows: result,
    note: "Primary mechanism is distributed over wrong-outcome trials only; mandate_attempt is a rate over all trials because the barrier made those outcomes correct." };
}
