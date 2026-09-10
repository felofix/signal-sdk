/**
 * Experiments: several functions, one book, a set of rulers, a table.
 *
 * The same machinery as a certificate, without the insurance framing.
 * Comparisons here are exploratory unless you predeclare them in the config.
 */

import { type Domain, RETURN_VALUES } from "./domain.js";
import { type Json, Measurement, MeasurementConfig, type TaskDistribution, Scenario, Trial, ValidationError, type ValidityPeriod, plain } from "./models.js";
import { DEFAULT_RULERS, type Ruler, type RulerResult, applyRulers } from "./rulers.js";
import { FunctionImplementation, measure, observationRows } from "./runner.js";
import { type CompareResult, type ComparisonSpec, compare, metricValue } from "./statistics/core.js";

export class Experiment {
  constructor(
    readonly name: string,
    readonly measurement: Measurement,
    readonly rulers: readonly Ruler[],
    readonly results: Record<string, Record<string, RulerResult>>,
    readonly comparisons: Record<string, CompareResult>,
    readonly baseline: string,
  ) { Object.freeze(this); }

  get functions(): Record<string, string> {
    return Object.fromEntries(this.measurement.functions.map((f) => [f.name, f.id]));
  }

  /** Markdown: one row per function, one column per ruler, estimate [low, high]. */
  table(): string {
    const names = this.rulers.map((r) => r.name);
    const lines = [`| Function | ${names.join(" | ")} |`, `|---|${"---|".repeat(names.length)}`];
    for (const [fn, values] of Object.entries(this.results)) {
      const tag = this.measurement.controlIds.includes(this.functions[fn]) ? " (control)" : "";
      lines.push(`| ${fn}${tag} | ${names.map((n) => cell(values[n])).join(" | ")} |`);
    }
    return lines.join("\n");
  }

  markdown(): string {
    const scenarios = this.measurement.scenarios.filter((t) => !t.variantOf).length;
    const lines = [`# Experiment: ${this.name}`, "",
      `Measurement \`${this.measurement.id}\` · ${scenarios} scenarios · ${this.measurement.config.repetitions} repetitions · baseline \`${this.baseline}\``, "",
      this.table(), ""];
    if (Object.keys(this.comparisons).length) {
      lines.push("## Paired differences against the baseline (exploratory, positive favours the candidate)", "", "| Candidate | Ruler | Advantage [95%] |", "|---|---|---|");
      for (const [candidate, report] of Object.entries(this.comparisons)) {
        for (const item of report.comparisons) lines.push(`| ${candidate} | ${item.name} | ${cell(item.advantage)} |`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  toJSON(): Json {
    return plain({ name: this.name, measurementId: this.measurement.id, baseline: this.baseline,
      rulers: this.rulers.map((r) => ({ name: r.name, description: r.description, metric: r.metric })), results: this.results, comparisons: this.comparisons });
  }
}

function cell(value: { estimate?: number | null; interval?: [number | null, number | null] } | undefined): string {
  if (!value || value.estimate === null || value.estimate === undefined) return "n/a";
  const [low, high] = value.interval ?? [null, null];
  if (low === null || high === null) return value.estimate.toFixed(3);
  return `${value.estimate.toFixed(3)} [${low.toFixed(3)}, ${high.toFixed(3)}]`;
}

export interface ExperimentOptions<Tools> {
  domain?: Domain<Tools>; rulers?: readonly Ruler[]; repetitions?: number; seed?: number; mode?: "simulation" | "real";
  config?: MeasurementConfig | null; validity?: ValidityPeriod | null; baseline?: string | null; onTrial?: (trial: Trial) => void;
}

/** Cross every function with the book, then read every ruler off the rows. */
export async function runExperiment<Tools = unknown>(name: string, functions: readonly FunctionImplementation<Tools>[], distribution: TaskDistribution,
  scenarios: readonly Scenario[], options: ExperimentOptions<Tools> = {}): Promise<Experiment> {
  const config = options.config ?? new MeasurementConfig({ mode: options.mode ?? "simulation", repetitions: options.repetitions ?? 3, seed: options.seed ?? 0 });
  const measurement = await measure(functions, distribution, scenarios, { domain: options.domain ?? (RETURN_VALUES as unknown as Domain<Tools>), config,
    validity: options.validity ?? null, onTrial: options.onTrial });
  return evaluate(name, measurement, options.rulers ?? DEFAULT_RULERS, { baseline: options.baseline ?? null });
}

/** Apply rulers to an existing measurement; use after rateTrials() adds new ratings. */
export function evaluate(name: string, measurement: Measurement, rulers: readonly Ruler[] = DEFAULT_RULERS, options: { baseline?: string | null } = {}): Experiment {
  const rows = observationRows(measurement);
  const { bootstrapSamples, seed } = measurement.config;
  const results = Object.fromEntries(measurement.functions.map((f) => [f.name, applyRulers(rows, rulers, { functionId: f.id, bootstrapSamples, seed })]));
  const baseline = options.baseline ?? measurement.functions[0].name;
  const ids = Object.fromEntries(measurement.functions.map((f) => [f.name, f.id]));
  if (!(baseline in ids)) throw new ValidationError(`Unknown baseline function ${baseline}`);
  // Only metrics observed on every trial can be paired; unreported cost or an absent custom metric is skipped.
  const paired: ComparisonSpec[] = rulers
    .filter((r) => r.metric && rows.every((row) => metricValue(row, r.metric!) !== null))
    .map((r) => ({ name: r.name, metric: r.metric!, confirmatory: false, direction: r.higherIsBetter ? "higher" : "lower" }));
  const comparisons: Record<string, CompareResult> = {};
  for (const fn of measurement.functions) {
    if (fn.name === baseline || measurement.controlIds.includes(fn.id) || !paired.length) continue;
    comparisons[fn.name] = compare(rows, ids[baseline], fn.id, { comparisons: paired, bootstrapSamples, seed });
  }
  return new Experiment(name, measurement, rulers, results, comparisons, baseline);
}

/**
 * Attach a rater's verdict to every trial and return a new snapshot.
 * This is how a human panel or a language-model judge enters an experiment:
 * after the fact, over recorded transcripts, as a rating that rulers such as
 * interRaterReliability() can hold against the deterministic grader.
 */
export async function rateTrials(measurement: Measurement, rater: string, judge: (scenario: Scenario, trial: Trial) => unknown | Promise<unknown>): Promise<Measurement> {
  const scenarios = new Map(measurement.scenarios.map((t) => [t.id, t]));
  const trials: Trial[] = [];
  for (const trial of measurement.trials) {
    const verdict = await judge(scenarios.get(trial.scenarioId)!, trial);
    trials.push(trial.with({ grades: trial.grades.with({ ratings: { ...trial.grades.ratings, [rater]: plain(verdict) } }) }));
  }
  return measurement.with({ trials });
}
