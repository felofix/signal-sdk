/** Immutable concepts and canonical identities for constructed risk measurement. */

import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ValidationError(message);
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Plain JSON for hashing and storage: sorted keys, no NaN or Infinity, models via toPlain. */
export function plain(value: unknown, computed = true): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    check(Number.isFinite(value), "JSON data cannot contain NaN or Infinity");
    return value;
  }
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => plain(item, computed));
  if (typeof (value as { toPlain?: unknown }).toPlain === "function") {
    return (value as { toPlain: (c: boolean) => Json }).toPlain(computed);
  }
  if (typeof value === "object") {
    const out: JsonObject = {};
    for (const key of Object.keys(value as object).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = plain(item, computed);
    }
    return out;
  }
  throw new ValidationError(`Cannot serialise a ${typeof value}`);
}

export function canonicalJson(value: unknown, computed = false): string {
  return JSON.stringify(plain(value, computed));
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value, false)).digest("hex");
}

export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(plain(value, true))) as T);
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function timestamp(value: unknown, what: string): string {
  check(typeof value === "string" && TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value)),
    `${what} must be an ISO-8601 timestamp with an explicit timezone`);
  return value;
}

export function now(): string {
  return new Date().toISOString();
}

function record(value: unknown, what: string, allowEmpty = true): JsonObject {
  check(value === undefined ? allowEmpty : value !== null && typeof value === "object" && !Array.isArray(value),
    `${what} must be an object`);
  return (value ?? {}) as JsonObject;
}

function text(value: unknown, what: string, minLength = 0): string {
  check(typeof value === "string" && value.length >= minLength, `${what} must be a string${minLength ? ` of at least ${minLength} character(s)` : ""}`);
  return value;
}

function number(value: unknown, what: string, options: { min?: number; max?: number; integer?: boolean } = {}): number {
  check(typeof value === "number" && Number.isFinite(value), `${what} must be a finite number`);
  if (options.integer) check(Number.isInteger(value), `${what} must be an integer`);
  if (options.min !== undefined) check(value >= options.min, `${what} must be at least ${options.min}`);
  if (options.max !== undefined) check(value <= options.max, `${what} must be at most ${options.max}`);
  return value;
}

function only(init: object, allowed: readonly string[], computed: readonly string[] = []): void {
  for (const key of Object.keys(init)) {
    check(allowed.includes(key) || computed.includes(key), `Unknown field ${key}`);
  }
}

function strings(value: unknown, what: string): readonly string[] {
  check(value === undefined || Array.isArray(value), `${what} must be a list of strings`);
  return Object.freeze(((value ?? []) as unknown[]).map((v) => text(v, `${what} item`)));
}

export const Label = { EASY: "easy", COMPLEX: "complex", IMPOSSIBLE: "impossible" } as const;
export type LabelSuggestion = (typeof Label)[keyof typeof Label];

// ---------------------------------------------------------------------------

export interface ModelIdentityInit { provider: string; name: string; version: string }

export class ModelIdentity {
  readonly provider: string;
  readonly name: string;
  readonly version: string;

  constructor(init: ModelIdentityInit) {
    only(init, ["provider", "name", "version"]);
    this.provider = text(init.provider, "provider", 1);
    this.name = text(init.name, "name", 1);
    this.version = text(init.version, "version", 1);
    check(!["latest", "default", "auto", "current"].includes(this.version.trim().toLowerCase()),
      "A model version identifier must be pinned, not a moving alias");
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject { return { provider: this.provider, name: this.name, version: this.version }; }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<ModelIdentityInit>): ModelIdentity { return new ModelIdentity({ ...this.toPlain(), ...update } as ModelIdentityInit); }
}

export interface ValidityPeriodInit { start: string; end: string }

export class ValidityPeriod {
  readonly start: string;
  readonly end: string;

  constructor(init: ValidityPeriodInit) {
    only(init, ["start", "end"]);
    this.start = timestamp(init.start, "start");
    this.end = timestamp(init.end, "end");
    check(Date.parse(this.end) > Date.parse(this.start), "Validity end must follow start");
    deepFreeze(this);
  }

  contains(when: string): boolean {
    const t = Date.parse(when);
    return Date.parse(this.start) <= t && t < Date.parse(this.end);
  }

  toPlain(_computed = true): JsonObject { return { start: this.start, end: this.end }; }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<ValidityPeriodInit>): ValidityPeriod { return new ValidityPeriod({ ...this.toPlain(), ...update } as ValidityPeriodInit); }
}

/** Static metadata for one threat class, written before any run. */
export interface ThreatSpec {
  /** Accepted terminal action classes; the first is the primary gold action. */
  goldActions: readonly string[];
  /** Mechanisms plausible if a function fails on this threat. Coverage checks only, never grading. */
  expectedMechanisms: readonly string[];
  /** Loss class a failure maps to; a hook for the loss layer. */
  expectedConsequenceClass: string | null;
  /** Mitigating barrier meant to catch a failure here. */
  barrier: "mandate" | "review" | "none";
  /** Injection vector, for injection threats only. */
  vector?: string | null;
}

export const NOMINAL_THREAT: ThreatSpec = Object.freeze({ goldActions: ["answer"], expectedMechanisms: ["misinterpretation", "hallucination"], expectedConsequenceClass: null, barrier: "none" });

function threatSpec(name: string, value: unknown): ThreatSpec {
  const spec = record(value, `threat ${name}`, false) as unknown as ThreatSpec;
  check(Array.isArray(spec.goldActions) && spec.goldActions.length > 0 && spec.goldActions.every((a) => typeof a === "string"), `threat ${name} needs goldActions`);
  check(Array.isArray(spec.expectedMechanisms ?? []), `threat ${name}: expectedMechanisms must be a list`);
  check(["mandate", "review", "none"].includes(spec.barrier), `threat ${name}: barrier must be mandate, review or none`);
  return { goldActions: [...spec.goldActions], expectedMechanisms: [...(spec.expectedMechanisms ?? [])], expectedConsequenceClass: spec.expectedConsequenceClass ?? null,
    barrier: spec.barrier, vector: spec.vector ?? null };
}

export interface TaskDistributionInit {
  name: string; generator?: string | null; parameters?: JsonObject; seed?: number | null; datasetHash?: string | null;
  threats?: Record<string, ThreatSpec>; threatRates?: Record<string, number>; labelRule: string; attackSuiteVersion?: string | null; topCluster?: string;
}

export class TaskDistribution {
  readonly name: string;
  readonly generator: string | null;
  readonly parameters: JsonObject;
  readonly seed: number | null;
  readonly datasetHash: string | null;
  readonly threats: Readonly<Record<string, ThreatSpec>>;
  readonly threatRates: Readonly<Record<string, number>>;
  readonly labelRule: string;
  readonly attackSuiteVersion: string | null;
  readonly topCluster: string;

  constructor(init: TaskDistributionInit) {
    only(init, ["name", "generator", "parameters", "seed", "datasetHash", "threats", "threatRates", "labelRule", "attackSuiteVersion", "topCluster"], ["id"]);
    this.name = text(init.name, "name", 1);
    this.generator = init.generator ?? null;
    this.parameters = clone(record(init.parameters, "parameters"));
    this.seed = init.seed ?? null;
    this.datasetHash = init.datasetHash ?? null;
    const threats = record(init.threats ?? { nominal: NOMINAL_THREAT }, "threats", false);
    this.threats = Object.fromEntries(Object.keys(threats).sort().map((k) => [k, threatSpec(k, threats[k])]));
    check(Object.keys(this.threats).length > 0, "A distribution needs at least one threat class");
    this.threatRates = clone(record(init.threatRates, "threatRates")) as Record<string, number>;
    this.labelRule = text(init.labelRule, "labelRule", 1);
    this.attackSuiteVersion = init.attackSuiteVersion ?? null;
    this.topCluster = init.topCluster ?? "scenario";
    check((this.generator === null) !== (this.datasetHash === null), "Supply either generator parameters with seed or a dataset hash");
    check(this.generator === null || this.seed !== null, "A generated distribution needs a seed");
    for (const [name, rate] of Object.entries(this.threatRates)) {
      number(rate, `threat rate ${name}`, { min: 0, max: 1 });
      check(name in this.threats, `threat rate ${name} has no threat class`);
    }
    deepFreeze(this);
  }

  get id(): string { return contentHash(this.toPlain(false)); }

  toPlain(computed = true): JsonObject {
    const out: JsonObject = {
      name: this.name, generator: this.generator, parameters: this.parameters, seed: this.seed, datasetHash: this.datasetHash,
      threats: clone(this.threats) as unknown as Json, threatRates: { ...this.threatRates }, labelRule: this.labelRule, attackSuiteVersion: this.attackSuiteVersion, topCluster: this.topCluster,
    };
    if (computed) out.id = this.id;
    return out;
  }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<TaskDistributionInit>): TaskDistribution { return new TaskDistribution({ ...(this.toPlain(false) as unknown as TaskDistributionInit), ...update }); }
}

export interface FunctionInit {
  implementation: JsonObject; model?: ModelIdentity | ModelIdentityInit | null; models?: readonly (ModelIdentity | ModelIdentityInit)[];
  prompts?: readonly string[]; configuration?: JsonObject; name?: string;
}

/** Only the system under test; external resources never enter this identity. */
export class Function {
  readonly implementation: JsonObject;
  readonly model: ModelIdentity | null;
  readonly models: readonly ModelIdentity[];
  readonly prompts: readonly string[];
  readonly configuration: JsonObject;
  readonly name: string;

  constructor(init: FunctionInit) {
    only(init, ["implementation", "model", "models", "prompts", "configuration", "name"], ["id", "componentHashes"]);
    this.implementation = clone(record(init.implementation, "implementation", false));
    check(Object.keys(this.implementation).length > 0, "Identify the tested implementation with a revision or content hash");
    this.model = init.model ? (init.model instanceof ModelIdentity ? init.model : new ModelIdentity(init.model)) : null;
    this.models = Object.freeze((init.models ?? []).map((m) => (m instanceof ModelIdentity ? m : new ModelIdentity(m))));
    check(!(this.model && this.models.length), "Use model for a single model or models for multiple models");
    this.prompts = strings(init.prompts, "prompts");
    this.configuration = clone(record(init.configuration, "configuration"));
    this.name = init.name ?? "function";
    deepFreeze(this);
  }

  get modelIdentities(): readonly ModelIdentity[] { return this.model ? [this.model] : this.models; }

  get componentHashes(): Record<string, string> {
    return {
      models: contentHash(this.modelIdentities.map((m) => m.toPlain(false))),
      prompts: contentHash(this.prompts),
      implementation: contentHash(this.implementation),
      configuration: contentHash(this.configuration),
    };
  }

  get id(): string { return contentHash(this.componentHashes); }

  toPlain(computed = true): JsonObject {
    const out: JsonObject = {
      implementation: this.implementation, model: this.model ? this.model.toPlain() : null,
      models: this.models.map((m) => m.toPlain()), prompts: [...this.prompts], configuration: this.configuration, name: this.name,
    };
    if (computed) { out.id = this.id; out.componentHashes = this.componentHashes; }
    return out;
  }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<FunctionInit>): Function { return new Function({ ...(this.toPlain(false) as unknown as FunctionInit), ...update }); }
}

export interface EnvironmentDefinitionInit {
  name?: string; implementation?: JsonObject; toolDescriptions?: JsonObject; configuration?: JsonObject; mandate?: JsonObject;
}

/** External conditions, tools and enforcement, bound to a measurement. */
export class EnvironmentDefinition {
  readonly name: string;
  readonly implementation: JsonObject;
  readonly toolDescriptions: JsonObject;
  readonly configuration: JsonObject;
  readonly mandate: JsonObject;

  constructor(init: EnvironmentDefinitionInit = {}) {
    only(init, ["name", "implementation", "toolDescriptions", "configuration", "mandate"], ["id"]);
    this.name = init.name ?? "return-values";
    this.implementation = clone(record(init.implementation ?? { version: "1" }, "implementation"));
    this.toolDescriptions = clone(record(init.toolDescriptions, "toolDescriptions"));
    this.configuration = clone(record(init.configuration, "configuration"));
    this.mandate = clone(record(init.mandate, "mandate"));
    deepFreeze(this);
  }

  get id(): string { return contentHash(this.toPlain(false)); }

  toPlain(computed = true): JsonObject {
    const out: JsonObject = { name: this.name, implementation: this.implementation, toolDescriptions: this.toolDescriptions,
      configuration: this.configuration, mandate: this.mandate };
    if (computed) out.id = this.id;
    return out;
  }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<EnvironmentDefinitionInit>): EnvironmentDefinition { return new EnvironmentDefinition({ ...(this.toPlain(false) as unknown as EnvironmentDefinitionInit), ...update }); }
}

export interface GraderDefinitionInit { name: string; version: string; components: JsonObject }

export class GraderDefinition {
  readonly name: string;
  readonly version: string;
  readonly components: JsonObject;

  constructor(init: GraderDefinitionInit) {
    only(init, ["name", "version", "components"], ["id"]);
    this.name = text(init.name, "name", 1);
    this.version = text(init.version, "version", 1);
    this.components = clone(record(init.components, "components"));
    deepFreeze(this);
  }

  get id(): string { return contentHash(this.toPlain(false)); }

  toPlain(computed = true): JsonObject {
    const out: JsonObject = { name: this.name, version: this.version, components: this.components };
    if (computed) out.id = this.id;
    return out;
  }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<GraderDefinitionInit>): GraderDefinition { return new GraderDefinition({ ...(this.toPlain(false) as unknown as GraderDefinitionInit), ...update }); }
}

export interface HazardInit { type: string; rate: number; vector?: string | null; instruction?: JsonObject; canary?: string | null }

export class Hazard {
  readonly type: string;
  readonly rate: number;
  readonly vector: string | null;
  readonly instruction: JsonObject;
  readonly canary: string | null;

  constructor(init: HazardInit) {
    only(init, ["type", "rate", "vector", "instruction", "canary"]);
    this.type = text(init.type, "type", 1);
    this.rate = number(init.rate, "rate", { min: 0, max: 1 });
    this.vector = init.vector ?? null;
    this.instruction = clone(record(init.instruction, "instruction"));
    this.canary = init.canary ?? null;
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject { return { type: this.type, rate: this.rate, vector: this.vector, instruction: this.instruction, canary: this.canary }; }
  toJSON(): JsonObject { return this.toPlain(true); }
}

export interface ScenarioInit {
  id: string; input: Json; state?: JsonObject; construction?: JsonObject; label: string; threat?: string; hazards?: readonly (Hazard | HazardInit)[];
  groundState: JsonObject; cluster: string; template?: string; variantOf?: string | null;
}

/** One constructed task: the unit for all statistics. */
export class Scenario {
  readonly id: string;
  readonly input: Json;
  readonly state: JsonObject;
  readonly construction: JsonObject;
  readonly label: string;
  readonly threat: string;
  readonly hazards: readonly Hazard[];
  readonly groundState: JsonObject;
  readonly cluster: string;
  readonly template: string;
  readonly variantOf: string | null;

  constructor(init: ScenarioInit) {
    only(init, ["id", "input", "state", "construction", "label", "threat", "hazards", "groundState", "cluster", "template", "variantOf"], ["contentId"]);
    this.id = text(init.id, "id", 1);
    this.input = clone(plain(init.input));
    this.state = clone(record(init.state, "state"));
    this.construction = clone(record(init.construction, "construction"));
    this.label = text(init.label, "label", 1);
    this.threat = text(init.threat ?? "nominal", "threat", 1);
    this.hazards = Object.freeze((init.hazards ?? []).map((h) => (h instanceof Hazard ? h : new Hazard(h))));
    this.groundState = clone(record(init.groundState, "groundState", false));
    this.cluster = text(init.cluster, "cluster", 1);
    this.template = init.template ?? "default";
    this.variantOf = init.variantOf ?? null;
    deepFreeze(this);
  }

  get contentId(): string { return contentHash(this.toPlain(false)); }

  toPlain(computed = true): JsonObject {
    const out: JsonObject = {
      id: this.id, input: this.input, state: this.state, construction: this.construction, label: this.label, threat: this.threat,
      hazards: this.hazards.map((h) => h.toPlain()), groundState: this.groundState, cluster: this.cluster, template: this.template, variantOf: this.variantOf,
    };
    if (computed) out.contentId = this.contentId;
    return out;
  }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<ScenarioInit>): Scenario { return new Scenario({ ...(this.toPlain(false) as unknown as ScenarioInit), ...update }); }
}

export interface MessageInit { role: string; content: string; stepIndex?: number | null }

export class Message {
  readonly role: string;
  readonly content: string;
  readonly stepIndex: number | null;

  constructor(init: MessageInit) {
    only(init, ["role", "content", "stepIndex"]);
    this.role = text(init.role, "role");
    this.content = text(init.content, "content");
    this.stepIndex = init.stepIndex === undefined || init.stepIndex === null ? null : number(init.stepIndex, "stepIndex", { min: 0, integer: true });
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject { return { role: this.role, content: this.content, stepIndex: this.stepIndex }; }
  toJSON(): JsonObject { return this.toPlain(true); }
}

export interface StepInit {
  index: number; kind: string; name: string; arguments?: JsonObject; result?: Json; durationMs?: number; tokens?: number | null;
  cost?: number | null; retry?: boolean; goal?: string | null; parentGoal?: string | null; metadata?: JsonObject;
}

export class Step {
  readonly index: number;
  readonly kind: string;
  readonly name: string;
  readonly arguments: JsonObject;
  readonly result: Json;
  readonly durationMs: number;
  readonly tokens: number | null;
  readonly cost: number | null;
  readonly retry: boolean;
  readonly goal: string | null;
  readonly parentGoal: string | null;
  readonly metadata: JsonObject;

  constructor(init: StepInit) {
    only(init, ["index", "kind", "name", "arguments", "result", "durationMs", "tokens", "cost", "retry", "goal", "parentGoal", "metadata"]);
    this.index = number(init.index, "index", { min: 0, integer: true });
    this.kind = text(init.kind, "kind");
    this.name = text(init.name, "name");
    this.arguments = clone(record(init.arguments, "arguments"));
    this.result = init.result === undefined ? null : clone(plain(init.result));
    this.durationMs = number(init.durationMs ?? 0, "durationMs", { min: 0 });
    this.tokens = init.tokens === null ? null : number(init.tokens ?? 0, "tokens", { min: 0 });
    this.cost = init.cost === undefined || init.cost === null ? null : number(init.cost, "cost", { min: 0 });
    this.retry = Boolean(init.retry);
    this.goal = init.goal ?? null;
    this.parentGoal = init.parentGoal ?? null;
    this.metadata = clone(record(init.metadata, "metadata"));
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject {
    return { index: this.index, kind: this.kind, name: this.name, arguments: this.arguments, result: this.result, durationMs: this.durationMs,
      tokens: this.tokens, cost: this.cost, retry: this.retry, goal: this.goal, parentGoal: this.parentGoal, metadata: this.metadata };
  }
  toJSON(): JsonObject { return this.toPlain(true); }
}

export interface TranscriptInit { steps?: readonly (Step | StepInit)[]; messages?: readonly (Message | MessageInit)[] }

export class Transcript {
  readonly steps: readonly Step[];
  readonly messages: readonly Message[];

  constructor(init: TranscriptInit = {}) {
    only(init, ["steps", "messages"]);
    this.steps = Object.freeze((init.steps ?? []).map((s) => (s instanceof Step ? s : new Step(s))));
    this.messages = Object.freeze((init.messages ?? []).map((m) => (m instanceof Message ? m : new Message(m))));
    check(this.steps.every((s, i) => s.index === i), "Transcript step indices must be contiguous and ordered");
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject { return { steps: this.steps.map((s) => s.toPlain()), messages: this.messages.map((m) => m.toPlain()) }; }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<TranscriptInit>): Transcript { return new Transcript({ steps: this.steps, messages: this.messages, ...update }); }
}

export interface ActionInit { tool: string; arguments: JsonObject; callIndex: number }

export class Action {
  readonly tool: string;
  readonly arguments: JsonObject;
  readonly callIndex: number;

  constructor(init: ActionInit) {
    only(init, ["tool", "arguments", "callIndex"]);
    this.tool = text(init.tool, "tool", 1);
    this.arguments = clone(record(init.arguments, "arguments"));
    this.callIndex = number(init.callIndex, "callIndex", { min: 0, integer: true });
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject { return { tool: this.tool, arguments: this.arguments, callIndex: this.callIndex }; }
  toJSON(): JsonObject { return this.toPlain(true); }
}

export interface OutcomeInit { value?: unknown; actions?: readonly (Action | ActionInit)[]; escalated?: boolean; state?: JsonObject }

/** The world after the trial. Never the function's claim. */
export class Outcome {
  readonly value: Json;
  readonly actions: readonly Action[];
  readonly escalated: boolean;
  readonly state: JsonObject;

  constructor(init: OutcomeInit = {}) {
    only(init, ["value", "actions", "escalated", "state"]);
    this.value = init.value === undefined ? null : clone(plain(init.value));
    this.actions = Object.freeze((init.actions ?? []).map((a) => (a instanceof Action ? a : new Action(a))));
    this.escalated = Boolean(init.escalated);
    this.state = clone(record(init.state, "state"));
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject { return { value: this.value, actions: this.actions.map((a) => a.toPlain()), escalated: this.escalated, state: this.state }; }
  toJSON(): JsonObject { return this.toPlain(true); }
}

export const DEVIATIONS = ["wrong_action", "wrong_value", "missing_action", "extra_action"] as const;
export type Deviation = (typeof DEVIATIONS)[number];

export interface OutcomeGradeInit {
  correct: boolean; fieldF1: number; action: string; goldAction: string; deviation?: Deviation | null; attemptedDeviation?: boolean;
}

/** The top event: does the final state match the ground state, and if not, how does it differ. */
export class OutcomeGrade {
  readonly correct: boolean;
  readonly fieldF1: number;
  readonly action: string;
  readonly goldAction: string;
  readonly deviation: Deviation | null;
  readonly attemptedDeviation: boolean;

  constructor(init: OutcomeGradeInit) {
    only(init, ["correct", "fieldF1", "action", "goldAction", "deviation", "attemptedDeviation"]);
    this.correct = Boolean(init.correct);
    this.fieldF1 = number(init.fieldF1, "fieldF1", { min: 0, max: 1 });
    this.action = text(init.action, "action", 1);
    this.goldAction = text(init.goldAction, "goldAction", 1);
    this.deviation = init.deviation ?? null;
    check(this.deviation === null || (DEVIATIONS as readonly string[]).includes(this.deviation), "deviation must be one of the closed set");
    check(this.correct === (this.deviation === null), "A wrong outcome needs a deviation and a correct one has none");
    this.attemptedDeviation = init.attemptedDeviation ?? !this.correct;
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject {
    return { correct: this.correct, fieldF1: this.fieldF1, action: this.action, goldAction: this.goldAction, deviation: this.deviation, attemptedDeviation: this.attemptedDeviation };
  }
  toJSON(): JsonObject { return this.toPlain(true); }
}

export interface MechanismGradeInit { detected?: readonly string[]; primary?: string | null; mandateAttempt?: boolean; precedence?: readonly string[] }

/** Attribution from the transcript; primary is set only when the outcome is wrong. */
export class MechanismGrade {
  readonly detected: readonly string[];
  readonly primary: string | null;
  readonly mandateAttempt: boolean;
  readonly precedence: readonly string[];

  constructor(init: MechanismGradeInit = {}) {
    only(init, ["detected", "primary", "mandateAttempt", "precedence"]);
    this.detected = strings(init.detected, "detected");
    this.primary = init.primary ?? null;
    this.mandateAttempt = Boolean(init.mandateAttempt);
    this.precedence = strings(init.precedence, "precedence");
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject { return { detected: [...this.detected], primary: this.primary, mandateAttempt: this.mandateAttempt, precedence: [...this.precedence] }; }
  toJSON(): JsonObject { return this.toPlain(true); }
}

export interface ProcessGradeInit { schemaValid: boolean; steps: number; retries: number; tokens: number | null; cost?: number | null; latencyMs: number; pathSignature: string }

export class ProcessGrade {
  readonly schemaValid: boolean;
  readonly steps: number;
  readonly retries: number;
  readonly tokens: number | null;
  readonly cost: number | null;
  readonly latencyMs: number;
  readonly pathSignature: string;

  constructor(init: ProcessGradeInit) {
    only(init, ["schemaValid", "steps", "retries", "tokens", "cost", "latencyMs", "pathSignature"]);
    this.schemaValid = Boolean(init.schemaValid);
    this.steps = number(init.steps, "steps", { min: 0, integer: true });
    this.retries = number(init.retries, "retries", { min: 0, integer: true });
    this.tokens = init.tokens === null ? null : number(init.tokens, "tokens", { min: 0 });
    this.cost = init.cost === undefined || init.cost === null ? null : number(init.cost, "cost", { min: 0 });
    this.latencyMs = number(init.latencyMs, "latencyMs", { min: 0 });
    this.pathSignature = text(init.pathSignature, "pathSignature");
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject {
    return { schemaValid: this.schemaValid, steps: this.steps, retries: this.retries, tokens: this.tokens, cost: this.cost, latencyMs: this.latencyMs, pathSignature: this.pathSignature };
  }
  toJSON(): JsonObject { return this.toPlain(true); }
}

export interface GradesInit {
  outcome: OutcomeGrade | OutcomeGradeInit; mechanism?: MechanismGrade | MechanismGradeInit; consequences?: Record<string, boolean>;
  process: ProcessGrade | ProcessGradeInit; metrics?: Record<string, number>; ratings?: JsonObject;
}

/** Outcome and mechanism are the two measurement columns; process, metrics and ratings ride along. Nothing is combined into one score. */
export class Grades {
  readonly outcome: OutcomeGrade;
  readonly mechanism: MechanismGrade;
  readonly consequences: Readonly<Record<string, boolean>>;
  readonly process: ProcessGrade;
  readonly metrics: Readonly<Record<string, number>>;
  readonly ratings: JsonObject;

  constructor(init: GradesInit) {
    only(init, ["outcome", "mechanism", "consequences", "process", "metrics", "ratings"]);
    this.outcome = init.outcome instanceof OutcomeGrade ? init.outcome : new OutcomeGrade(init.outcome);
    this.mechanism = init.mechanism instanceof MechanismGrade ? init.mechanism : new MechanismGrade(init.mechanism ?? {});
    check(this.outcome.correct ? this.mechanism.primary === null : this.mechanism.primary !== null, "Exactly one primary mechanism on a wrong outcome, none on a correct one");
    this.consequences = clone(record(init.consequences, "consequences")) as Record<string, boolean>;
    this.process = init.process instanceof ProcessGrade ? init.process : new ProcessGrade(init.process);
    const metrics = record(init.metrics, "metrics");
    for (const [key, value] of Object.entries(metrics)) number(value, `metric ${key}`);
    this.metrics = clone(metrics) as Record<string, number>;
    this.ratings = clone(record(init.ratings, "ratings"));
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject {
    return { outcome: this.outcome.toPlain(), mechanism: this.mechanism.toPlain(), consequences: { ...this.consequences }, process: this.process.toPlain(), metrics: { ...this.metrics }, ratings: this.ratings };
  }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<GradesInit>): Grades {
    return new Grades({ outcome: this.outcome, mechanism: this.mechanism, consequences: this.consequences, process: this.process, metrics: this.metrics, ratings: this.ratings, ...update });
  }
}

export interface TrialInit {
  scenarioId: string; functionId: string; repetition: number; seed: number; transcript: Transcript | TranscriptInit;
  outcome: Outcome | OutcomeInit; grades: Grades | GradesInit; error?: string | null;
}

export class Trial {
  readonly scenarioId: string;
  readonly functionId: string;
  readonly repetition: number;
  readonly seed: number;
  readonly transcript: Transcript;
  readonly outcome: Outcome;
  readonly grades: Grades;
  readonly error: string | null;

  constructor(init: TrialInit) {
    only(init, ["scenarioId", "functionId", "repetition", "seed", "transcript", "outcome", "grades", "error"]);
    this.scenarioId = text(init.scenarioId, "scenarioId", 1);
    this.functionId = text(init.functionId, "functionId", 1);
    this.repetition = number(init.repetition, "repetition", { min: 0, integer: true });
    this.seed = number(init.seed, "seed", { min: 0, integer: true });
    this.transcript = init.transcript instanceof Transcript ? init.transcript : new Transcript(init.transcript);
    this.outcome = init.outcome instanceof Outcome ? init.outcome : new Outcome(init.outcome);
    this.grades = init.grades instanceof Grades ? init.grades : new Grades(init.grades);
    this.error = init.error ?? null;
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject {
    return { scenarioId: this.scenarioId, functionId: this.functionId, repetition: this.repetition, seed: this.seed,
      transcript: this.transcript.toPlain(), outcome: this.outcome.toPlain(), grades: this.grades.toPlain(), error: this.error };
  }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<TrialInit>): Trial {
    return new Trial({ scenarioId: this.scenarioId, functionId: this.functionId, repetition: this.repetition, seed: this.seed,
      transcript: this.transcript, outcome: this.outcome, grades: this.grades, error: this.error, ...update });
  }
}

export const STANDARD_METRICS = ["correct", "cost", "latencyMs", "tokens", "steps", "retries", "schemaValid", "fieldF1"] as const;

export interface ConfirmatoryComparisonInit {
  name: string; referenceId: string; candidateId: string; metric: string; margin: number; maximumSeverity?: number | null;
  confirmatory?: boolean; direction?: "higher" | "lower" | null; unit?: string | null; valueBounds?: readonly [number, number] | null;
}

export class ConfirmatoryComparison {
  readonly name: string;
  readonly referenceId: string;
  readonly candidateId: string;
  readonly metric: string;
  readonly margin: number;
  readonly maximumSeverity: number | null;
  readonly confirmatory: boolean;
  readonly direction: "higher" | "lower" | null;
  readonly unit: string | null;
  readonly valueBounds: readonly [number, number] | null;

  constructor(init: ConfirmatoryComparisonInit) {
    only(init, ["name", "referenceId", "candidateId", "metric", "margin", "maximumSeverity", "confirmatory", "direction", "unit", "valueBounds"]);
    this.name = text(init.name, "name", 1);
    this.referenceId = text(init.referenceId, "referenceId", 1);
    this.candidateId = text(init.candidateId, "candidateId", 1);
    this.metric = text(init.metric, "metric", 1);
    this.margin = number(init.margin, "margin", { min: 0 });
    this.maximumSeverity = init.maximumSeverity === undefined || init.maximumSeverity === null ? null : number(init.maximumSeverity, "maximumSeverity");
    check(this.maximumSeverity === null || this.maximumSeverity > 0, "maximumSeverity must be positive");
    this.confirmatory = init.confirmatory ?? true;
    this.direction = init.direction ?? null;
    this.unit = init.unit ?? null;
    this.valueBounds = init.valueBounds ? Object.freeze([init.valueBounds[0], init.valueBounds[1]] as [number, number]) : null;
    check((STANDARD_METRICS as readonly string[]).includes(this.metric) || this.metric.startsWith("loss:") || this.metric.startsWith("metric:"),
      "Use a process/outcome metric, loss:<harm>, or metric:<customName>");
    check(this.metric !== "loss:" && this.metric !== "metric:", "A comparison must name its metric");
    check(!this.metric.startsWith("metric:") || (this.direction !== null && this.unit !== null), "Custom metric comparisons require an explicit direction and unit");
    check(!this.valueBounds || this.valueBounds[0] < this.valueBounds[1], "Metric lower bound must be below its upper bound");
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject {
    return { name: this.name, referenceId: this.referenceId, candidateId: this.candidateId, metric: this.metric, margin: this.margin,
      maximumSeverity: this.maximumSeverity, confirmatory: this.confirmatory, direction: this.direction, unit: this.unit,
      valueBounds: this.valueBounds ? [...this.valueBounds] : null };
  }
  toJSON(): JsonObject { return this.toPlain(true); }
}

export interface ComparisonPlanInit { declaredAt: string; comparisons: readonly (ConfirmatoryComparison | ConfirmatoryComparisonInit)[] }

export class ComparisonPlan {
  readonly declaredAt: string;
  readonly comparisons: readonly ConfirmatoryComparison[];

  constructor(init: ComparisonPlanInit) {
    only(init, ["declaredAt", "comparisons"], ["id"]);
    this.declaredAt = timestamp(init.declaredAt, "declaredAt");
    this.comparisons = Object.freeze(init.comparisons.map((c) => (c instanceof ConfirmatoryComparison ? c : new ConfirmatoryComparison(c))));
    check(this.comparisons.length > 0, "A plan needs comparisons");
    check(new Set(this.comparisons.map((c) => c.name)).size === this.comparisons.length, "Comparison names must be unique");
    deepFreeze(this);
  }

  get id(): string { return contentHash(this.toPlain(false)); }

  toPlain(computed = true): JsonObject {
    const out: JsonObject = { declaredAt: this.declaredAt, comparisons: this.comparisons.map((c) => c.toPlain()) };
    if (computed) out.id = this.id;
    return out;
  }
  toJSON(): JsonObject { return this.toPlain(true); }
}

export type SeverityAssumption = { distribution?: "fixed" | "gamma" | "lognormal"; amount?: number; mean?: number; coefficientOfVariation?: number; currency: string };

export interface MeasurementConfigInit {
  repetitions?: number; seed?: number; bootstrapSamples?: number; lossSimulations?: number; currency?: string;
  severityAssumptions?: Record<string, SeverityAssumption>; confirmatoryComparisons?: readonly (ConfirmatoryComparison | ConfirmatoryComparisonInit)[];
  prepostPlan?: ComparisonPlan | ComparisonPlanInit | null; calibrationTargetResidualLoss?: number | null; mode?: "simulation" | "real";
}

export class MeasurementConfig {
  readonly repetitions: number;
  readonly seed: number;
  readonly bootstrapSamples: number;
  readonly lossSimulations: number;
  readonly currency: string;
  readonly severityAssumptions: Readonly<Record<string, SeverityAssumption>>;
  readonly confirmatoryComparisons: readonly ConfirmatoryComparison[];
  readonly prepostPlan: ComparisonPlan | null;
  readonly calibrationTargetResidualLoss: number | null;
  readonly mode: "simulation" | "real";

  constructor(init: MeasurementConfigInit = {}) {
    only(init, ["repetitions", "seed", "bootstrapSamples", "lossSimulations", "currency", "severityAssumptions", "confirmatoryComparisons",
      "prepostPlan", "calibrationTargetResidualLoss", "mode"]);
    this.repetitions = number(init.repetitions ?? 3, "repetitions", { min: 2, integer: true });
    this.seed = number(init.seed ?? 0, "seed", { min: 0, integer: true });
    this.bootstrapSamples = number(init.bootstrapSamples ?? 2000, "bootstrapSamples", { min: 200, integer: true });
    this.lossSimulations = number(init.lossSimulations ?? 5000, "lossSimulations", { min: 200, integer: true });
    this.currency = init.currency ?? "USD";
    this.severityAssumptions = clone(record(init.severityAssumptions, "severityAssumptions")) as unknown as Record<string, SeverityAssumption>;
    this.confirmatoryComparisons = Object.freeze((init.confirmatoryComparisons ?? []).map((c) => (c instanceof ConfirmatoryComparison ? c : new ConfirmatoryComparison(c))));
    this.prepostPlan = init.prepostPlan ? (init.prepostPlan instanceof ComparisonPlan ? init.prepostPlan : new ComparisonPlan(init.prepostPlan)) : null;
    this.calibrationTargetResidualLoss = init.calibrationTargetResidualLoss === undefined || init.calibrationTargetResidualLoss === null
      ? null : number(init.calibrationTargetResidualLoss, "calibrationTargetResidualLoss", { min: 0 });
    this.mode = init.mode ?? "simulation";
    check(this.mode === "simulation" || this.mode === "real", "mode must be simulation or real");
    check(!(this.prepostPlan && this.confirmatoryComparisons.length), "Use one pre/post plan for the entire confirmatory family, not separate comparison declarations");
    for (const assumption of Object.values(this.severityAssumptions)) {
      check(assumption.currency === this.currency, "Severity assumptions must use the measurement currency");
    }
    check(new Set(this.confirmatoryComparisons.map((c) => c.name)).size === this.confirmatoryComparisons.length, "Confirmatory comparison names must be unique");
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject {
    return { repetitions: this.repetitions, seed: this.seed, bootstrapSamples: this.bootstrapSamples, lossSimulations: this.lossSimulations,
      currency: this.currency, severityAssumptions: clone(this.severityAssumptions) as unknown as Json, confirmatoryComparisons: this.confirmatoryComparisons.map((c) => c.toPlain()),
      prepostPlan: this.prepostPlan ? this.prepostPlan.toPlain(false) : null, calibrationTargetResidualLoss: this.calibrationTargetResidualLoss, mode: this.mode };
  }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<MeasurementConfigInit>): MeasurementConfig {
    return new MeasurementConfig({ repetitions: this.repetitions, seed: this.seed, bootstrapSamples: this.bootstrapSamples, lossSimulations: this.lossSimulations,
      currency: this.currency, severityAssumptions: this.severityAssumptions, confirmatoryComparisons: this.confirmatoryComparisons, prepostPlan: this.prepostPlan,
      calibrationTargetResidualLoss: this.calibrationTargetResidualLoss, mode: this.mode, ...update });
  }
}

export interface MeasurementInit {
  schemaVersion?: "3"; functions: readonly (Function | FunctionInit)[]; distribution: TaskDistribution | TaskDistributionInit;
  environment: EnvironmentDefinition | EnvironmentDefinitionInit; graders: GraderDefinition | GraderDefinitionInit;
  validity?: ValidityPeriod | ValidityPeriodInit | null; controlIds?: readonly string[]; scenarios: readonly (Scenario | ScenarioInit)[];
  trials: readonly (Trial | TrialInit)[]; timestamp: string; config: MeasurementConfig | MeasurementConfigInit; validation: JsonObject; elapsedSeconds?: number;
}

/** The immutable crossing of functions × scenarios × repetitions. */
export class Measurement {
  readonly schemaVersion: "3" = "3";
  readonly functions: readonly Function[];
  readonly distribution: TaskDistribution;
  readonly environment: EnvironmentDefinition;
  readonly graders: GraderDefinition;
  readonly validity: ValidityPeriod | null;
  readonly controlIds: readonly string[];
  readonly scenarios: readonly Scenario[];
  readonly trials: readonly Trial[];
  readonly timestamp: string;
  readonly config: MeasurementConfig;
  readonly validation: JsonObject;
  readonly elapsedSeconds: number;

  constructor(init: MeasurementInit) {
    only(init, ["schemaVersion", "functions", "distribution", "environment", "graders", "validity", "controlIds", "scenarios", "trials",
      "timestamp", "config", "validation", "elapsedSeconds"], ["id", "bindingId"]);
    check(init.schemaVersion === undefined || init.schemaVersion === "3", "Unsupported measurement schema version");
    this.functions = Object.freeze(init.functions.map((f) => (f instanceof Function ? f : new Function(f))));
    this.distribution = init.distribution instanceof TaskDistribution ? init.distribution : new TaskDistribution(init.distribution);
    this.environment = init.environment instanceof EnvironmentDefinition ? init.environment : new EnvironmentDefinition(init.environment);
    this.graders = init.graders instanceof GraderDefinition ? init.graders : new GraderDefinition(init.graders);
    this.validity = init.validity ? (init.validity instanceof ValidityPeriod ? init.validity : new ValidityPeriod(init.validity)) : null;
    this.controlIds = strings(init.controlIds, "controlIds");
    this.scenarios = Object.freeze(init.scenarios.map((t) => (t instanceof Scenario ? t : new Scenario(t))));
    this.trials = Object.freeze(init.trials.map((t) => (t instanceof Trial ? t : new Trial(t))));
    this.timestamp = timestamp(init.timestamp, "timestamp");
    this.config = init.config instanceof MeasurementConfig ? init.config : new MeasurementConfig(init.config);
    this.validation = clone(record(init.validation, "validation", false));
    this.elapsedSeconds = number(init.elapsedSeconds ?? 0, "elapsedSeconds", { min: 0 });

    const scenarioIds = new Set(this.scenarios.map((t) => t.id));
    const functionIds = new Set(this.functions.map((f) => f.id));
    check(scenarioIds.size > 0 && scenarioIds.size === this.scenarios.length, "Scenarios must be nonempty and have unique IDs");
    check(functionIds.size > 0 && functionIds.size === this.functions.length, "Functions must be nonempty and have unique IDs");
    check(this.validation.status === "PASS", "A measurement must bind passing self-validation evidence");
    check(!this.config.prepostPlan || Date.parse(this.config.prepostPlan.declaredAt) <= Date.parse(this.timestamp), "A comparison plan must be declared before measurement");
    check(!this.validity || this.validity.contains(this.timestamp), "Measurement timestamp is outside its validity period");
    check(this.controlIds.every((id) => functionIds.has(id)), "Control identities must belong to the measured crossing");
    const expected = new Set<string>();
    for (const t of scenarioIds) for (const f of functionIds) for (let r = 0; r < this.config.repetitions; r++) expected.add(`${t} ${f} ${r}`);
    const observed = new Set(this.trials.map((t) => `${t.scenarioId} ${t.functionId} ${t.repetition}`));
    check(observed.size === this.trials.length && observed.size === expected.size && [...observed].every((k) => expected.has(k)),
      "Measurement must have a complete crossed trial design");
    const seeds = new Map<string, number>();
    for (const trial of this.trials) {
      const key = `${trial.scenarioId} ${trial.repetition}`;
      check(!seeds.has(key) || seeds.get(key) === trial.seed, "All functions must use the same seeds for paired trials");
      seeds.set(key, trial.seed);
    }
    deepFreeze(this);
  }

  get id(): string { return contentHash(this.toPlain(false)); }

  get bindingId(): string {
    return contentHash({ functions: this.functions.map((f) => f.id), distribution: this.distribution.id, environment: this.environment.id,
      graders: this.graders.id, validity: this.validity ? this.validity.toPlain() : null });
  }

  toPlain(computed = true): JsonObject {
    const out: JsonObject = {
      schemaVersion: this.schemaVersion, functions: this.functions.map((f) => f.toPlain(computed)), distribution: this.distribution.toPlain(computed),
      environment: this.environment.toPlain(computed), graders: this.graders.toPlain(computed), validity: this.validity ? this.validity.toPlain() : null,
      controlIds: [...this.controlIds], scenarios: this.scenarios.map((t) => t.toPlain(computed)), trials: this.trials.map((t) => t.toPlain()),
      timestamp: this.timestamp, config: this.config.toPlain(), validation: this.validation, elapsedSeconds: this.elapsedSeconds,
    };
    if (computed) { out.id = this.id; out.bindingId = this.bindingId; }
    return out;
  }
  toJSON(): JsonObject { return this.toPlain(true); }
  with(update: Partial<MeasurementInit>): Measurement {
    return new Measurement({ functions: this.functions, distribution: this.distribution, environment: this.environment, graders: this.graders,
      validity: this.validity, controlIds: this.controlIds, scenarios: this.scenarios, trials: this.trials, timestamp: this.timestamp,
      config: this.config, validation: this.validation, elapsedSeconds: this.elapsedSeconds, ...update });
  }
  static fromJSON(data: unknown): Measurement {
    check(data !== null && typeof data === "object", "A measurement snapshot must be an object");
    return new Measurement(data as unknown as MeasurementInit);
  }
}

export interface AuditSampleInit {
  scenarioId: string; functionId: string; cluster: string; timestamp: string; judgedSafe: boolean; selectedForAudit: boolean;
  inclusionProbability: number; attempted: Record<string, boolean>; cost: number; humanReviewed?: boolean;
}

export class AuditSample {
  readonly scenarioId: string;
  readonly functionId: string;
  readonly cluster: string;
  readonly timestamp: string;
  readonly judgedSafe: boolean;
  readonly selectedForAudit: boolean;
  readonly inclusionProbability: number;
  readonly attempted: Readonly<Record<string, boolean>>;
  readonly cost: number;
  readonly humanReviewed: boolean;

  constructor(init: AuditSampleInit) {
    only(init, ["scenarioId", "functionId", "cluster", "timestamp", "judgedSafe", "selectedForAudit", "inclusionProbability", "attempted", "cost", "humanReviewed"]);
    this.scenarioId = text(init.scenarioId, "scenarioId", 1);
    this.functionId = text(init.functionId, "functionId", 1);
    this.cluster = text(init.cluster, "cluster", 1);
    this.timestamp = timestamp(init.timestamp, "timestamp");
    this.judgedSafe = Boolean(init.judgedSafe);
    this.selectedForAudit = Boolean(init.selectedForAudit);
    this.inclusionProbability = number(init.inclusionProbability, "inclusionProbability", { max: 1 });
    check(this.inclusionProbability > 0, "inclusionProbability must be positive");
    this.attempted = clone(record(init.attempted, "attempted")) as Record<string, boolean>;
    this.cost = number(init.cost, "cost", { min: 0 });
    this.humanReviewed = init.humanReviewed ?? true;
    check(this.judgedSafe && this.selectedForAudit && this.humanReviewed, "Drift accepts only randomly audited, human-reviewed safe scenarios");
    deepFreeze(this);
  }

  toPlain(_computed = true): JsonObject {
    return { scenarioId: this.scenarioId, functionId: this.functionId, cluster: this.cluster, timestamp: this.timestamp, judgedSafe: this.judgedSafe,
      selectedForAudit: this.selectedForAudit, inclusionProbability: this.inclusionProbability, attempted: { ...this.attempted }, cost: this.cost, humanReviewed: this.humanReviewed };
  }
  toJSON(): JsonObject { return this.toPlain(true); }
}
