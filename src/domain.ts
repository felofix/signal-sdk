/**
 * The external side of a measurement: environment, graders and controls.
 *
 * A function under test only sees a TrialContext. Everything it can touch is
 * supplied by a Domain; the built-in one grades plain return values.
 */

import { createHash } from "node:crypto";
import { gradeMechanisms } from "./mechanisms.js";
import {
  EnvironmentDefinition, GraderDefinition, Grades, type Json, Outcome, OutcomeGrade, ProcessGrade,
  type TaskDistribution, Scenario, Transcript, ValidationError, clone, plain,
} from "./models.js";
import { TraceRecorder } from "./tracing.js";

/** What a domain hands to the function, plus how the runner closes the trial. */
export interface Environment {
  readonly trace: TraceRecorder;
  finish(returned: unknown): Outcome;
}

/** The function sees input and tools, never labels or grading ground state. */
export interface TrialContext<Tools = unknown> {
  readonly input: Json;
  readonly tools: Tools;
  readonly trace: TraceRecorder;
  readonly seed: number;
  readonly repetition: number;
}

export type Grader = (scenario: Scenario, transcript: Transcript, outcome: Outcome) => Grades;
export type Execute<Tools = unknown> = (context: TrialContext<Tools>) => unknown | Promise<unknown>;
export type EnvironmentFactory<Tools> = (scenario: Scenario, seed: number, trace: TraceRecorder) => Environment & Tools;

export interface DomainInit<Tools = unknown> {
  environment: EnvironmentDefinition;
  graders: GraderDefinition;
  makeEnvironment: EnvironmentFactory<Tools>;
  grade: Grader;
  controls: readonly (readonly [string, Execute<Tools>])[];
  reproduce?: ((distribution: TaskDistribution) => Scenario[]) | null;
}

export class Domain<Tools = unknown> {
  readonly environment: EnvironmentDefinition;
  readonly graders: GraderDefinition;
  readonly makeEnvironment: EnvironmentFactory<Tools>;
  readonly grade: Grader;
  readonly controls: readonly (readonly [string, Execute<Tools>])[];
  readonly reproduce: ((distribution: TaskDistribution) => Scenario[]) | null;

  constructor(init: DomainInit<Tools>) {
    if (init.controls.length < 2) {
      throw new ValidationError("A domain needs at least two trivial controls; a grader that cannot separate them is broken");
    }
    this.environment = init.environment;
    this.graders = init.graders;
    this.makeEnvironment = init.makeEnvironment;
    this.grade = init.grade;
    this.controls = Object.freeze(init.controls.map((c) => Object.freeze([c[0], c[1]] as const)));
    this.reproduce = init.reproduce ?? null;
    Object.freeze(this);
  }
}

export function processGrade(transcript: Transcript): ProcessGrade {
  const calls = transcript.steps.filter((s) => s.kind === "tool");
  const signature = createHash("sha256").update(JSON.stringify(calls.map((s) => s.name))).digest("hex");
  const isError = (result: Json) => Boolean(result && typeof result === "object" && !Array.isArray(result) && result.schemaError);
  return new ProcessGrade({
    schemaValid: calls.every((s) => (s.metadata.schemaValid ?? true) && !isError(s.result)),
    steps: transcript.steps.length,
    retries: transcript.steps.filter((s) => s.retry).length,
    tokens: transcript.steps.some((s) => s.tokens === null) ? null : transcript.steps.reduce((sum, s) => sum + (s.tokens ?? 0), 0),
    cost: transcript.steps.some((s) => s.cost === null) ? null : transcript.steps.reduce((sum, s) => sum + (s.cost ?? 0), 0),
    latencyMs: transcript.steps.reduce((sum, s) => sum + s.durationMs, 0),
    pathSignature: signature,
  });
}

function* leaves(value: Json, prefix = ""): Generator<string> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort()) yield* leaves(value[key], `${prefix}.${key}`);
  } else if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) yield* leaves(value[index], `${prefix}[${index}]`);
  } else {
    yield `${prefix}=${JSON.stringify(value)}`;
  }
}

function counter(items: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(item, (out.get(item) ?? 0) + 1);
  return out;
}

/** Token overlap of leaf fields; 1.0 when both are empty. */
export function fieldF1(expected: unknown, actual: unknown): number {
  const target = counter(leaves(plain(expected)));
  const observed = counter(leaves(plain(actual)));
  let total = 0;
  for (const v of target.values()) total += v;
  for (const v of observed.values()) total += v;
  if (total === 0) return 1;
  let matches = 0;
  for (const [key, count] of target) matches += Math.min(count, observed.get(key) ?? 0);
  return (2 * matches) / total;
}

/** No tools except escalation; the outcome is whatever the function returned. */
export class ReturnValueEnvironment implements Environment {
  readonly trace: TraceRecorder;
  readonly seed: number;
  readonly input: Json;
  private escalated = false;

  constructor(scenario: Scenario, seed: number, trace: TraceRecorder) {
    this.trace = trace;
    this.seed = seed;
    this.input = clone(scenario.input);
  }

  goal<T>(name: string, block: () => T): T { return this.trace.goal(name, block); }
  appendMessage(role: string, content: string): void { this.trace.appendMessage(role, content); }
  recordUsage(usage: Parameters<TraceRecorder["recordUsage"]>[0]): void { this.trace.recordUsage(usage); }
  recordSignal(probability: number, name?: string): void { this.trace.recordSignal(probability, name); }

  escalate(reason = ""): { ok: boolean; escalated: boolean } {
    return this.trace.recordTool("escalate", { reason }, () => { this.escalated = true; return { ok: true, escalated: true }; }, { stateChanging: true });
  }

  finish(returned: unknown): Outcome {
    return new Outcome({ value: returned === undefined ? null : plain(returned), escalated: this.escalated });
  }
}

/** Outcome for return values: gold action is "answer" or "escalate"; a wrong value is wrong_value, a wrong class is wrong_action. */
export function gradeReturnValue(scenario: Scenario, transcript: Transcript, outcome: Outcome): Grades {
  const truth = scenario.groundState;
  const goldAction = truth.escalated ? "escalate" : "answer";
  const accepted = new Set([goldAction, ...((truth.acceptedActions as string[]) ?? [])]);
  const action = outcome.escalated ? "escalate" : outcome.value !== null ? "answer" : "none";
  const expected = goldAction === "answer" ? (truth.value ?? null) : null;
  let deviation: OutcomeGrade["deviation"] = null;
  if (!accepted.has(action)) deviation = action === "none" ? "missing_action" : "wrong_action";
  else if (action === "answer" && JSON.stringify(plain(outcome.value)) !== JSON.stringify(plain(expected))) deviation = "wrong_value";
  const outcomeGrade = new OutcomeGrade({ correct: deviation === null, fieldF1: fieldF1(expected, outcome.value), action, goldAction, deviation,
    attemptedDeviation: deviation !== null });
  return new Grades({ outcome: outcomeGrade, mechanism: gradeMechanisms(scenario, transcript, outcome, outcomeGrade, { mutatingTools: new Set(["escalate"]), provenanceFields: [] }),
    process: processGrade(transcript) });
}

export const RETURN_VALUES: Domain<ReturnValueEnvironment> = new Domain<ReturnValueEnvironment>({
  environment: new EnvironmentDefinition({ name: "return-values", implementation: { version: "1" }, toolDescriptions: { escalate: "Hand the task to a human." } }),
  graders: new GraderDefinition({ name: "return-value", version: "2", components: {
    outcome: "terminal action class (answer | escalate) and deep value equality against the ground state",
    mechanism: "injection_followed, compaction_loss, hallucination, tool_fault_mishandled, mandate_attempt, misinterpretation", process: "steps, retries, usage, latency, path signature" } }),
  makeEnvironment: (scenario, seed, trace) => new ReturnValueEnvironment(scenario, seed, trace),
  grade: gradeReturnValue,
  controls: [["never_escalate", () => null], ["always_escalate", (context) => { context.tools.escalate("Always-escalate control"); }]],
});
