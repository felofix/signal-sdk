/** Configuration-derived risk certificates and paired pre/post reports. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Json, type JsonObject, type Measurement, ValidationError, contentHash, deepFreeze, plain } from "./models.js";
import { mechanismColumn, outcomeColumn } from "./columns.js";
import { observationRows } from "./runner.js";
import { calibrate, robustness } from "./statistics/calibration.js";
import { type CompareResult, type Estimate, compare, summarize } from "./statistics/core.js";
import { difficulty } from "./statistics/difficulty.js";
import { lossDistribution } from "./statistics/loss.js";

export interface Section { title: string; data: Json }

export class RiskCertificate {
  constructor(readonly measurementId: string, readonly functionId: string, readonly status: string, readonly columns: JsonObject, readonly sections: readonly Section[]) {
    deepFreeze(this);
  }
  get id(): string { return contentHash(this.toJSON()); }
  toJSON(): JsonObject { return { measurementId: this.measurementId, functionId: this.functionId, status: this.status, columns: this.columns, sections: plain(this.sections) }; }
}

export function limitations(measurement: Measurement, functionId: string): string[] {
  const missing = measurement.trials.filter((t) => t.functionId === functionId && t.grades.process.cost === null).length;
  const period = measurement.validity ? ` during ${measurement.validity.start} to ${measurement.validity.end}` : "; no validity period was declared";
  const lines = [
    `This snapshot applies only to function ${functionId} on distribution ${measurement.distribution.id} in environment ${measurement.environment.id} under graders ${measurement.graders.id}${period}.`,
    "A model update at the provider invalidates this certificate, even if the public model name stays the same. Re-measure with a pinned provider version.",
    "Changing the function (models, prompts, implementation, configuration) makes a new function. Changing the environment, its tools or mandate, the task distribution, the graders, or the period requires a new measurement.",
    `Severity is assumed. Configured severity distributions: ${JSON.stringify(plain(measurement.config.severityAssumptions))}.`,
    measurement.distribution.attackSuiteVersion
      ? `The attack suite ${measurement.distribution.attackSuiteVersion} gives a lower bound on attack exposure; untested attacks are outside this measurement.`
      : "No attack suite was injected; this measurement says nothing about adversarial inputs.",
    "The unit is the scenario. Repetitions are dependent; top-level clusters are assumed exchangeable and independent. Shared effects across declared clusters invalidate these intervals.",
    "Confidence intervals use a top-cluster bootstrap with a cluster-t envelope and conservative bounded-sample guards. Coverage is approximate, especially with few clusters.",
    "Difficulty and loss predictions depend on printed model and severity assumptions. A 95% posterior interval is not a frequentist coverage guarantee.",
    "Attempted deviation is read from emitted actions and occurred deviation from the final state; their difference is the mitigating barrier's effect. Loss, when rendered, maps the outcome column through an assumed severity table and is not summed across threats.",
    "One outcome grader defines correctness for every threat; mechanisms are attribution from the transcript and are reported only on wrong outcomes. A function's textual claims provide no evidence of safe final state.",
    "Calibration measures association with attempts; review curves assume loss prevention by review. They do not implement a router or establish a causal effect of human review.",
    "Drift is measured only on randomly selected, human-reviewed operational scenarios judged safe; this constructed measurement alone does not measure drift.",
    "Function adapters are trusted instrumentation. The runtime is not a security sandbox, and content hashes provide integrity checks, not a digital signature or external timestamp attestation.",
    `Simulation self-validation status: ${String(measurement.validation.status ?? "missing")}. Passing finite seeded checks does not establish validity in every statistical regime.`,
  ];
  if (measurement.config.mode === "simulation") lines.push("This is a simulation measurement. It makes no claim about a real provider-backed function.");
  if (missing) lines.push(`Actual monetary usage was not recorded for ${missing} trials; totals cover recorded usage only.`);
  if (!Object.keys(measurement.config.severityAssumptions).length) lines.push("No severity assumptions were supplied, so a monetary loss distribution is not estimable.");
  return lines;
}

/** Compute each analysis once and emit one ordered certificate per function. */
export function certificates(measurement: Measurement): RiskCertificate[] {
  const rows = observationRows(measurement);
  const config = measurement.config;
  const summary = summarize(rows, { bootstrapSamples: config.bootstrapSamples, seed: config.seed });
  const hard = difficulty(rows, { seed: config.seed });
  const robust = robustness(observationRows(measurement, { includeVariants: true }), { bootstrapSamples: config.bootstrapSamples, seed: config.seed });
  const labels: Record<string, number> = {};
  for (const t of measurement.scenarios) if (!t.variantOf) labels[t.label] = (labels[t.label] ?? 0) + 1;
  const comparisons = withinComparisons(measurement, rows);
  const threats = measurement.distribution.threats;
  return measurement.functions.map((fn) => {
    const fid = fn.id;
    const stats = summary.functions[fid];
    const selected = measurement.trials.filter((t) => t.functionId === fid);
    const own = rows.filter((r) => r.functionId === fid);
    const outcome = outcomeColumn(own, threats, { bootstrapSamples: config.bootstrapSamples, seed: config.seed });
    const mechanism = mechanismColumn(own, threats, { bootstrapSamples: config.bootstrapSamples, seed: config.seed });
    const loss = lossDistribution(rows, { functionId: fid, severityAssumptions: config.severityAssumptions, simulations: config.lossSimulations, seed: config.seed });
    const calibration = calibrate(rows, { functionId: fid, targetResidualLoss: config.calibrationTargetResidualLoss, bootstrapSamples: config.bootstrapSamples, seed: config.seed });
    const costs = selected.map((t) => t.grades.process.cost);
    const versionErrors = selected.filter((t) => t.error && t.error.toLowerCase().includes("provider version"));
    let status = config.mode === "simulation" ? "simulation" : "measured";
    if (measurement.controlIds.includes(fid)) status = "control";
    if (versionErrors.length) status = "invalid_provider_version";
    else if (selected.some((t) => t.error)) status = "execution_errors_present";
    const sections: Section[] = [
      { title: "Function identity", data: fn.toPlain() },
      { title: "Task distribution", data: measurement.distribution.toPlain() },
      { title: "Environment and graders", data: { environment: measurement.environment.toPlain(), graders: measurement.graders.toPlain() } },
      { title: "Validity and re-measurement", data: { period: measurement.validity ? measurement.validity.toPlain() : null, measurementTimestamp: measurement.timestamp,
        triggers: ["provider model update", "prompt change", "implementation or configuration change", "environment, tool or mandate change", "distribution change", "grader change", "period expiry"] } },
      { title: "Outcome by threat", data: plain(outcome) },
      { title: "Mechanism by threat", data: plain(mechanism) },
      { title: "Custom metrics", data: plain(stats.metrics) },
      ...(Object.keys(config.severityAssumptions).length ? [{ title: "Loss per 10,000 scenarios", data: plain(loss) }] : []),
      { title: "Book difficulty", data: plain({ labelCounts: labels, outcome: stats.outcome,
        mixedModel: Object.fromEntries(Object.entries(hard).filter(([k]) => !["empiricalDifficulty", "predictions"].includes(k))),
        empiricalDifficulty: hard.empiricalDifficulty[fid] ?? null, prediction: hard.predictions[fid] ?? null }) },
      { title: "Consistency and process", data: plain({ consistency: stats.consistency, process: stats.process }) },
      { title: "Calibration", data: plain(calibration) },
      { title: "Robustness", data: plain(robust.functions[fid]) },
      { title: "Attack suite", data: plain({ threats: Object.entries(threats).filter(([, s]) => s.vector).map(([name, s]) => ({ threat: name, vector: s.vector })),
        scope: measurement.distribution.attackSuiteVersion
        ? `Injection threats were measured against the specific suite ${measurement.distribution.attackSuiteVersion}, not all attacks.` : "No attack suite was injected in this distribution." }) },
      { title: "What this measurement does not say", data: limitations(measurement, fid) },
      { title: "Hours and cost spent", data: plain({ measurementWallHours: measurement.elapsedSeconds / 3600,
        functionStepHours: selected.reduce((s, t) => s + t.grades.process.latencyMs, 0) / 3600000,
        recordedCost: costs.reduce<number>((s, c) => s + (c ?? 0), 0), currency: config.currency, trialsWithMissingCost: costs.filter((c) => c === null).length,
        selfValidationSeconds: measurement.validation.elapsedSeconds ?? null, trialErrors: selected.map((t) => t.error).filter(Boolean) }) },
      { title: "Predeclared comparisons", data: plain(comparisons) },
    ];
    return new RiskCertificate(measurement.id, fid, status, plain({ outcome, mechanism, process: stats.process, metrics: stats.metrics }) as JsonObject, sections);
  });
}

function withinComparisons(measurement: Measurement, rows: ReturnType<typeof observationRows>): CompareResult[] {
  const families = new Map<string, typeof measurement.config.confirmatoryComparisons[number][]>();
  for (const item of measurement.config.confirmatoryComparisons) {
    const key = `${item.referenceId}|${item.candidateId}`;
    families.set(key, [...(families.get(key) ?? []), item]);
  }
  let familySize = measurement.config.confirmatoryComparisons.filter((c) => c.confirmatory).length;
  if (measurement.config.prepostPlan) familySize += measurement.config.prepostPlan.comparisons.filter((c) => c.confirmatory).length;
  return [...families.entries()].map(([key, items]) => {
    const [a, b] = key.split("|");
    return compare(rows, a, b, { comparisons: items.map((c) => c.toPlain() as never), familySize, bootstrapSamples: measurement.config.bootstrapSamples, seed: measurement.config.seed });
  });
}

/** Compare the same scenarios as pairs, using a plan bound before execution. */
export function compareMeasurements(pre: Measurement, post: Measurement): JsonObject {
  const book = (m: Measurement) => contentHash(m.scenarios.map((t) => t.toPlain(false)));
  if (pre.distribution.id !== post.distribution.id || book(pre) !== book(post)) throw new ValidationError("Pre/post comparisons require identical scenario contents and distribution");
  if (pre.environment.id !== post.environment.id || pre.graders.id !== post.graders.id) throw new ValidationError("Pre/post comparisons require the same environment and graders");
  if (Date.parse(pre.timestamp) > Date.parse(post.timestamp)) throw new ValidationError("Pre measurement must precede post measurement");
  if (pre.config.repetitions !== post.config.repetitions) throw new ValidationError("Pre/post comparisons require the same repetitions");
  const plan = pre.config.prepostPlan;
  if (!plan || !post.config.prepostPlan || plan.id !== post.config.prepostPlan.id) throw new ValidationError("Both measurements must bind the same predeclared comparison plan");
  if (Date.parse(plan.declaredAt) > Date.parse(pre.timestamp)) throw new ValidationError("The comparison plan must predate both measurements");
  const preRows = observationRows(pre), postRows = observationRows(post);
  const familySize = plan.comparisons.filter((c) => c.confirmatory).length + pre.config.confirmatoryComparisons.filter((c) => c.confirmatory).length
    + post.config.confirmatoryComparisons.filter((c) => c.confirmatory).length;
  const reports = plan.comparisons.map((comparison) => {
    const left = preRows.filter((r) => r.functionId === comparison.referenceId).map((r) => ({ ...r, functionId: "pre" }));
    const right = postRows.filter((r) => r.functionId === comparison.candidateId).map((r) => ({ ...r, functionId: "post" }));
    const result = compare([...left, ...right], "pre", "post", { comparisons: [comparison.toPlain() as never], familySize, bootstrapSamples: post.config.bootstrapSamples, seed: post.config.seed });
    return { ...result, referenceFunctionId: comparison.referenceId, candidateFunctionId: comparison.candidateId,
      comparisonKind: comparison.referenceId !== comparison.candidateId ? "different_functions" : "same_function_two_measurements" };
  });
  return plain({ preMeasurementId: pre.id, postMeasurementId: post.id, plan: plan.toPlain(), pairedDifferences: reports,
    preCertificates: certificates(pre).map((c) => c.toJSON()), postCertificates: certificates(post).map((c) => c.toJSON()),
    interpretation: "Different function IDs compare two functions, not two versions of one function." }) as JsonObject;
}

function rate(value: Partial<Estimate> | null | undefined): string {
  if (!value || value.estimate === null || value.estimate === undefined) return "not estimable";
  const [low, high] = value.interval ?? [null, null];
  const fmt = (v: number) => Number(v.toPrecision(4)).toString();
  if (low === null || high === null) return `${fmt(value.estimate)}; interval not estimable`;
  return `${fmt(value.estimate)} [${fmt(low)}, ${fmt(high)}]`;
}

export function markdown(certificate: RiskCertificate): string {
  const lines = ["# Signal risk certificate", "", `Status: **${certificate.status}**`, "", `Measurement: \`${certificate.measurementId}\``, "",
    `Function: \`${certificate.functionId}\``, "", "Outcome, events and process are separate measurements. Intervals are 95% unless multiplicity adjustment is stated.", ""];
  for (const section of certificate.sections) {
    lines.push(`## ${section.title}`, "");
    const data = section.data as never;
    if (section.title === "Outcome by threat") {
      const column = data as { rows: { threat: string; barrier: string | null; n: number; correct: Estimate; attemptedDeviation: Estimate; occurredDeviation: Estimate; byLabel: Record<string, { n: number; correct: Estimate; attemptedDeviation: Estimate; occurredDeviation: Estimate }> }[];
        population: { n: number; correct: Estimate; attemptedDeviation: Estimate; occurredDeviation: Estimate; mix: Record<string, number>; note: string }; derived: { escalatedWhenImpossible: Estimate; unnecessaryEscalation: Estimate } };
      lines.push("| Threat | Barrier | n | Correct [interval] | Attempted deviation [interval] | Occurred deviation [interval] |", "|---|---|---:|---|---|---|");
      for (const row of column.rows) {
        lines.push(`| ${row.threat} | ${row.barrier ?? ""} | ${row.n} | ${rate(row.correct)} | ${rate(row.attemptedDeviation)} | ${rate(row.occurredDeviation)} |`);
        for (const [label, c] of Object.entries(row.byLabel)) lines.push(`| ↳ ${label} | | ${c.n} | ${rate(c.correct)} | ${rate(c.attemptedDeviation)} | ${rate(c.occurredDeviation)} |`);
      }
      const mix = Object.entries(column.population.mix).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(", ");
      lines.push(`| population (mix: ${mix}) | | ${column.population.n} | ${rate(column.population.correct)} | ${rate(column.population.attemptedDeviation)} | ${rate(column.population.occurredDeviation)} |`, "");
      for (const row of column.rows) {
        const note = row.occurredDeviation.zeroEventNote;
        if (note) lines.push(`${row.threat}: ${note}`, "");
      }
      lines.push(`Escalated when impossible: ${rate(column.derived.escalatedWhenImpossible)}. Unnecessary escalation: ${rate(column.derived.unnecessaryEscalation)}.`, "");
    } else if (section.title === "Mechanism by threat") {
      const column = data as { precedence: string[]; note: string; rows: { threat: string; wrongTrials: number; expectedMechanisms: string[]; primary: Record<string, Estimate>; mandateAttempt: Estimate }[] };
      const mechanisms = column.rows.length ? Object.keys(column.rows[0].primary) : [];
      lines.push(`Precedence for the primary mechanism: ${column.precedence.join(" › ")}.`, "", `| Threat | Wrong trials | ${mechanisms.join(" | ")} | mandate_attempt (all trials) |`, `|---|---:|${"---|".repeat(mechanisms.length)}---|`);
      for (const row of column.rows) lines.push(`| ${row.threat} | ${row.wrongTrials} | ${mechanisms.map((m) => rate(row.primary[m])).join(" | ")} | ${rate(row.mandateAttempt)} |`);
      lines.push("", column.note, "");
    } else if (section.title === "Custom metrics") {
      const metrics = data as Record<string, Estimate>;
      if (!Object.keys(metrics).length) lines.push("No custom metrics are defined in this environment.", "");
      else { lines.push("| Metric | Estimate [interval] |", "|---|---|", ...Object.entries(metrics).map(([k, v]) => `| ${k} | ${rate(v)} |`), ""); }
    } else if (section.title === "Function identity") {
      const fn = data as { name: string; model: JsonObject | null; models: JsonObject[]; implementation: JsonObject; componentHashes: Record<string, string> };
      const models = fn.model ? [fn.model] : fn.models ?? [];
      lines.push(`Name: **${fn.name}**`, "");
      for (const m of models) lines.push(`Model: \`${m.provider}/${m.name}\`; pinned version \`${m.version}\`.`);
      if (!models.length) lines.push("No model identity declared (a control or a model-free implementation).");
      lines.push("", `Implementation: \`${JSON.stringify(plain(fn.implementation))}\``, "", "| Component | SHA-256 |", "|---|---|");
      for (const [k, v] of Object.entries(fn.componentHashes)) lines.push(`| ${k} | \`${v}\` |`);
      lines.push("");
    } else if (section.title === "Loss per 10,000 scenarios") {
      const loss = data as { harms: Record<string, { status: string; mean?: number; p95?: number; p99?: number; expectedLossInterval?: [number, number]; severityAssumption?: JsonObject }>; assumptions: string[] };
      lines.push("| Harm | Mean | 95th percentile | 99th percentile | Expected-loss interval |", "|---|---:|---:|---:|---|");
      for (const [harm, result] of Object.entries(loss.harms)) {
        if (result.status !== "simulated") lines.push(`| ${harm} | Not estimable: severity assumption required | | | |`);
        else lines.push(`| ${harm} | ${result.mean!.toFixed(2)} | ${result.p95!.toFixed(2)} | ${result.p99!.toFixed(2)} | [${result.expectedLossInterval![0].toFixed(2)}, ${result.expectedLossInterval![1].toFixed(2)}] |`);
      }
      lines.push("", "These are assumption-dependent posterior predictions. Severity assumptions:", "");
      for (const [harm, result] of Object.entries(loss.harms)) if (result.severityAssumption) lines.push(`- ${harm}: \`${JSON.stringify(plain(result.severityAssumption))}\``);
      lines.push("", ...loss.assumptions.map((a) => `- ${a}`), "");
    } else if (section.title === "Book difficulty") {
      const d = data as { labelCounts: JsonObject; outcome: { correct: Estimate; fieldF1: Estimate; escalatedWhenImpossible: Estimate }; mixedModel: JsonObject;
        empiricalDifficulty: { status: string; scenarios?: Record<string, number> } | null; prediction: { observedBookExpectedCorrectRate: Estimate; nextBookCorrectRate: Estimate; predictionWiderThanMeasuredInterval: boolean } | null };
      lines.push(`Labels: ${JSON.stringify(plain(d.labelCounts))}.`, "", `Correct final state: ${rate(d.outcome.correct)}.`, "", `Field-level F1: ${rate(d.outcome.fieldF1)}.`, "",
        `Escalated when impossible: ${rate(d.outcome.escalatedWhenImpossible)}.`, "");
      lines.push(`Mixed model: ${String(d.mixedModel.status)}. ${String(d.mixedModel.method ?? d.mixedModel.reason ?? "")}`, "");
      if (typeof d.mixedModel.labelExplainedLatentFraction === "number") lines.push(`Label-explained latent variance fraction: ${d.mixedModel.labelExplainedLatentFraction.toPrecision(4)}.`, "");
      if (d.empiricalDifficulty?.status === "estimated" && d.empiricalDifficulty.scenarios) {
        const values = Object.values(d.empiricalDifficulty.scenarios);
        lines.push(`Leave-function-out estimated failure probabilities across scenarios: ${Math.min(...values).toFixed(3)} to ${Math.max(...values).toFixed(3)}. Full per-scenario estimates are in the JSON certificate.`, "");
      }
      if (d.prediction) {
        lines.push(`Measured-book expected correctness: ${rate(d.prediction.observedBookExpectedCorrectRate)}.`, "",
          `Next 10,000 scenario correctness: ${rate(d.prediction.nextBookCorrectRate)} (posterior prediction).`, "",
          `Prediction-width check: ${d.prediction.predictionWiderThanMeasuredInterval ? "PASS" : "FAIL"}.`, "");
      }
    } else if (section.title === "Consistency and process") {
      const d = data as { consistency: { repetitions: number; passPowerK: Estimate; pathConsistency: Estimate }; process: Record<string, Estimate | JsonObject> };
      lines.push(`Repetitions: ${d.consistency.repetitions}.`, "", `pass^k (all repetitions correct): ${rate(d.consistency.passPowerK)}.`, "",
        `Identical tool-call path: ${rate(d.consistency.pathConsistency)}.`, "", "| Process measurement | Estimate [interval] |", "|---|---|");
      for (const [k, v] of Object.entries(d.process)) if (k !== "costDistribution") lines.push(`| ${k} | ${rate(v as Estimate)} |`);
      lines.push("", "Cost distribution (actual reported usage):", "", "```json", JSON.stringify(d.process.costDistribution, null, 2), "```", "");
    } else if (section.title === "Calibration") {
      const c = data as { status: string; reason?: string; chosenThreshold?: number; split?: { trainingScenarios: number; testScenarios: number };
        calibrationCurve?: { bin: [number, number]; meanSignal: number; attemptRate: Estimate }[]; reviewCurve?: { threshold: number; reviewFraction: Estimate; residualLossPer10000: Estimate }[]; assumptions?: string[] };
      lines.push(`Status: ${c.status}.`, "");
      if (c.status !== "estimated") lines.push(c.reason ?? "", "");
      else {
        lines.push(`Chosen threshold: ${Number(c.chosenThreshold!.toPrecision(6))}; fitted on ${c.split!.trainingScenarios} scenarios and reported on ${c.split!.testScenarios} scenarios from disjoint clusters.`, "",
          "| Signal bin | Mean signal | Attempt rate [interval] |", "|---|---:|---|");
        for (const p of c.calibrationCurve!) lines.push(`| [${p.bin[0]}, ${p.bin[1]}] | ${p.meanSignal.toFixed(3)} | ${rate(p.attemptRate)} |`);
        lines.push("", "| Threshold | Review fraction [interval] | Residual loss / 10,000 [interval] |", "|---:|---|---|");
        for (const p of c.reviewCurve!) lines.push(`| ${Number(p.threshold.toPrecision(3))} | ${rate(p.reviewFraction)} | ${rate(p.residualLossPer10000)} |`);
        lines.push("", ...(c.assumptions ?? []).map((a) => `- ${a}`), "");
      }
    } else if (section.title === "Robustness") {
      const r = data as Record<string, Estimate | null>;
      for (const key of ["cosmeticOutcomeChangeFraction", "toolFaultMishandledFraction"]) lines.push(`${key}: ${r[key] ? rate(r[key]) : "not measured"}.`, "");
    } else if (section.title === "Attack suite") {
      const suite = data as { scope: string; threats: { threat: string; vector: string }[] };
      lines.push(suite.scope, "", ...suite.threats.map((th) => `- ${th.threat} (vector: ${th.vector})`), "");
    } else if (Array.isArray(data) && (data as unknown[]).every((v) => typeof v === "string")) {
      lines.push(...(data as string[]).map((item) => `- ${item}`), "");
    } else {
      lines.push("```json", JSON.stringify(data, null, 2), "```", "");
    }
  }
  return lines.join("\n");
}

export function exportCertificates(measurement: Measurement, directory: string): string[] {
  mkdirSync(directory, { recursive: true });
  const paths: string[] = [];
  for (const report of certificates(measurement)) {
    const jsonPath = join(directory, `${report.functionId}.json`), mdPath = join(directory, `${report.functionId}.md`);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    writeFileSync(mdPath, markdown(report));
    paths.push(jsonPath, mdPath);
  }
  return paths;
}
