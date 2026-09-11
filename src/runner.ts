/** Crossed execution with isolated tools, environment controls, and a validation gate. */

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { type Environment, type Execute, RETURN_VALUES } from "./environment.js";
import {
  Function, Measurement, MeasurementConfig, NOMINAL_THREAT, TaskDistribution, Scenario, type ThreatSpec, Trial, ValidationError, type ValidityPeriod,
  clone, contentHash, now,
} from "./models.js";
import type { Row } from "./statistics/core.js";
import { TraceRecorder } from "./tracing.js";
import { selfValidate } from "./validation.js";

export type ImplementationKind = "real" | "simulation" | "control";

export class FunctionImplementation<T = unknown> {
  readonly definition: Function;
  readonly execute: Execute<T>;
  readonly kind: ImplementationKind;

  constructor(definition: Function, execute: Execute<T>, kind: ImplementationKind = "real") {
    if (!["real", "simulation", "control"].includes(kind) || typeof execute !== "function") {
      throw new ValidationError("A function implementation needs a callable and a valid execution kind");
    }
    this.definition = definition;
    this.execute = execute;
    this.kind = kind;
    Object.freeze(this);
  }
}

/** Controls are functions like any other; their identity is the control itself. */
export function controlFunctions<T>(environment: Environment<T>): FunctionImplementation<T>[] {
  return environment.controls.map(([name, execute]) =>
    new FunctionImplementation(new Function({ name, implementation: { control: name, environment: environment.definition.name } }), execute, "control"));
}

export function trialSeed(masterSeed: number, scenario: Scenario, repetition: number): number {
  // A variant has the seed of its original, including across functions.
  const identity = `${masterSeed}:${scenario.variantOf ?? scenario.id}:${repetition}`;
  return createHash("sha256").update(identity).digest().readUInt32BE(0);
}

/** Bind a hand-built book by the hash of its complete content. */
export function datasetDistribution(name: string, scenarios: readonly Scenario[], options: {
  labelRule: string; threats?: Record<string, ThreatSpec>; threatRates?: Record<string, number>; attackSuiteVersion?: string | null; topCluster?: string;
}): TaskDistribution {
  const threats = options.threats ?? Object.fromEntries([...new Set(scenarios.map((s) => s.threat))].map((t) => [t, NOMINAL_THREAT]));
  return new TaskDistribution({ name, datasetHash: contentHash(scenarios.map((t) => t.toPlain(false))), labelRule: options.labelRule, threats,
    threatRates: options.threatRates ?? {}, attackSuiteVersion: options.attackSuiteVersion ?? null, topCluster: options.topCluster ?? "scenario" });
}

function verifyBook(distribution: TaskDistribution, scenarios: readonly Scenario[], environment: Environment<unknown>): void {
  const hash = contentHash(scenarios.map((t) => t.toPlain(false)));
  if (distribution.datasetHash) {
    if (hash !== distribution.datasetHash) throw new ValidationError("Scenario content does not match the distribution dataset hash");
  } else if (!environment.reproduce) {
    throw new ValidationError("This environment cannot reproduce generated books; bind scenarios with datasetDistribution");
  } else if (hash !== contentHash(environment.reproduce(distribution).map((t) => t.toPlain(false)))) {
    throw new ValidationError("Scenarios do not reproduce the bound generator configuration");
  }
  for (const scenario of scenarios) {
    if (!(scenario.threat in distribution.threats)) throw new ValidationError(`Scenario ${scenario.id} has threat ${scenario.threat}, which the distribution does not declare`);
  }
  const originals = new Map(scenarios.filter((t) => !t.variantOf).map((t) => [t.id, t]));
  for (const scenario of scenarios) {
    if (!scenario.variantOf) continue;
    const base = originals.get(scenario.variantOf);
    if (!base || base.label !== scenario.label || base.threat !== scenario.threat || base.cluster !== scenario.cluster || contentHash(base.groundState) !== contentHash(scenario.groundState)) {
      throw new ValidationError("Variants must retain original label, threat, cluster, and ground state");
    }
  }
}

export async function execute<T>(implementation: FunctionImplementation<T>, scenario: Scenario, repetition: number, seed: number,
  environment: Environment<T> = RETURN_VALUES as unknown as Environment<T>): Promise<Trial> {
  const trace = new TraceRecorder();
  const tools = environment.makeTools(scenario, seed, trace);
  const input = scenario.input;
  const task = input && typeof input === "object" && !Array.isArray(input) && "task" in input ? input.task : input;
  trace.appendMessage("user", typeof task === "string" ? task : JSON.stringify(task));
  const context = { input: clone(scenario.input), tools, trace, seed, repetition };
  let error: string | null = null;
  let response: unknown = null;
  try {
    response = await implementation.execute(context);
    if (response !== null && response !== undefined) trace.appendMessage("assistant", typeof response === "string" ? response : JSON.stringify(response));
    if (implementation.kind === "real") {
      const modelSteps = trace.steps.filter((s) => s.kind === "model");
      if (!modelSteps.length) throw new ValidationError("Real functions must record actual model usage and providerVersion");
      const versions = new Set(implementation.definition.modelIdentities.map((m) => m.version));
      if (modelSteps.some((s) => !versions.has(String(s.metadata.providerVersion)))) {
        throw new ValidationError("Observed provider version does not match the insured function");
      }
    }
  } catch (caught) {
    const e = caught as Error;
    error = `${e.name}: ${e.message}`;
    trace.appendMessage("execution_error", error);
  }
  if (implementation.kind === "real" && !trace.steps.some((s) => s.kind === "model")) {
    trace.recordUsage({ tokens: null, cost: null, name: "unreported_usage", metadata: { usageMissing: true } });
  }
  const transcript = trace.transcript();
  const outcome = tools.finish(response);
  return new Trial({ scenarioId: scenario.id, functionId: implementation.definition.id, repetition, seed, transcript, outcome,
    grades: environment.grade(scenario, transcript, outcome), error });
}

export interface MeasureOptions<T> {
  environment?: Environment<T>; config?: MeasurementConfig | null; validity?: ValidityPeriod | null; onTrial?: (trial: Trial) => void;
}

/** Run the full crossing. Environment controls and self-validation are mandatory. */
export async function measure<T = unknown>(functions: readonly FunctionImplementation<T>[], distribution: TaskDistribution,
  scenarios: readonly Scenario[], options: MeasureOptions<T> = {}): Promise<Measurement> {
  const environment = (options.environment ?? RETURN_VALUES) as unknown as Environment<T>;
  const config = options.config ?? new MeasurementConfig({ mode: "real" });
  if (!functions.length) throw new ValidationError("Provide at least one function implementation");
  verifyBook(distribution, scenarios, environment as unknown as Environment<unknown>);
  const timestamp = now();
  if (options.validity && !options.validity.contains(timestamp)) throw new ValidationError("Measurement must occur within its validity period");
  if (config.mode === "simulation" && functions.some((f) => f.kind === "real")) throw new ValidationError("Real functions cannot run in simulation mode");
  if (config.mode === "real" && functions.some((f) => f.kind !== "real")) throw new ValidationError("Real mode requires real function implementations");
  if (functions.some((f) => f.kind === "control")) throw new ValidationError("Controls are added by the runner; supply measured functions only");
  const definitions = new Set(functions.map((f) => f.definition.id));
  if (definitions.size !== functions.length) throw new ValidationError("Function identities must be distinct");
  for (const comparison of config.confirmatoryComparisons) {
    if (!definitions.has(comparison.referenceId) || !definitions.has(comparison.candidateId)) throw new ValidationError("Predeclared comparisons must reference supplied functions");
  }
  const validation = await selfValidate();
  if (validation.status !== "PASS") throw new Error("Self-validation failed; no function execution is allowed");
  const controls = controlFunctions(environment);
  const implementations = [...functions, ...controls];
  const started = performance.now();
  const trials: Trial[] = [];
  for (const scenario of scenarios) {
    for (let repetition = 0; repetition < config.repetitions; repetition++) {
      const seed = trialSeed(config.seed, scenario, repetition);
      for (const implementation of implementations) {
        const trial = await execute(implementation, scenario, repetition, seed, environment);
        trials.push(trial);
        options.onTrial?.(trial);
      }
    }
  }
  return new Measurement({ functions: implementations.map((f) => f.definition), distribution, environment: environment.definition, graders: environment.graders,
    validity: options.validity ?? null, controlIds: controls.map((c) => c.definition.id), scenarios, trials, timestamp, config,
    validation: validation as unknown as Record<string, never>, elapsedSeconds: (performance.now() - started) / 1000 });
}

/** Flatten statistical inputs without treating perturbations as new book scenarios. */
export function observationRows(measurement: Measurement, options: { includeVariants?: boolean } = {}): Row[] {
  const scenarios = new Map(measurement.scenarios.map((t) => [t.id, t]));
  const rows: Row[] = [];
  for (const trial of measurement.trials) {
    const scenario = scenarios.get(trial.scenarioId)!;
    if (scenario.variantOf && !options.includeVariants) continue;
    const { outcome: o, mechanism: m } = trial.grades;
    const consequenceClass = measurement.distribution.threats[scenario.threat]?.expectedConsequenceClass ?? null;
    // Compatibility maps for the statistics layer: attempts read actions, occurrences read the final state.
    const attempted: Record<string, boolean> = { deviation: o.attemptedDeviation, mandate_attempt: m.mandateAttempt };
    for (const mechanism of m.detected) attempted[mechanism] = true;
    const occurred: Record<string, boolean> = { deviation: !o.correct, ...trial.grades.consequences };
    if (consequenceClass) occurred[consequenceClass] = !o.correct;
    const severity: Record<string, number> = {};
    const signals = trial.transcript.steps.filter((s) => s.kind === "signal" && s.result && typeof s.result === "object" && !Array.isArray(s.result) && "riskSignal" in s.result)
      .map((s) => Number((s.result as { riskSignal: number }).riskSignal));
    rows.push({
      scenarioId: scenario.id, functionId: trial.functionId, repetition: trial.repetition, seed: trial.seed, cluster: scenario.cluster, label: scenario.label,
      threat: scenario.threat, correct: o.correct, fieldF1: o.fieldF1, action: o.action, goldAction: o.goldAction, deviation: o.deviation,
      attemptedDeviation: o.attemptedDeviation, occurredDeviation: !o.correct, mechanisms: [...m.detected], primaryMechanism: m.primary, mandateAttempt: m.mandateAttempt,
      mechanismPrecedence: [...m.precedence], consequences: { ...trial.grades.consequences }, consequenceClass, ratings: clone(trial.grades.ratings), schemaValid: trial.grades.process.schemaValid, steps: trial.grades.process.steps, retries: trial.grades.process.retries,
      tokens: trial.grades.process.tokens, cost: trial.grades.process.cost, latencyMs: trial.grades.process.latencyMs, pathSignature: trial.grades.process.pathSignature,
      attempted, occurred, severity, metrics: { ...trial.grades.metrics },
      riskSignal: signals.length ? signals[signals.length - 1] : null, variantOf: scenario.variantOf,
      groundStateHash: contentHash(scenario.groundState),
      outcomeSignature: contentHash({ value: trial.outcome.value, escalated: trial.outcome.escalated, actions: trial.outcome.actions.map((a) => [a.tool, a.arguments]) }),
      toolFault: scenario.hazards.some((h) => h.type === "tool_fault"), executionError: trial.error,
    });
  }
  return rows;
}
