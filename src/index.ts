/** Signal: measure agent systems with deterministic graders, rulers and paired statistics. */

export { Domain, RETURN_VALUES, ReturnValueEnvironment, fieldF1, gradeReturnValue, processGrade } from "./domain.js";
export type { Environment, EnvironmentFactory, Execute, Grader, TrialContext } from "./domain.js";
export { Experiment, evaluate, rateTrials, runExperiment } from "./experiment.js";
export {
  Action, AuditSample, ComparisonPlan, ConfirmatoryComparison, DEVIATIONS, EnvironmentDefinition, Function, Grades, GraderDefinition, Hazard, Label,
  Measurement, MeasurementConfig, MechanismGrade, Message, ModelIdentity, NOMINAL_THREAT, Outcome, OutcomeGrade, ProcessGrade, Step, TaskDistribution, Scenario, Transcript, Trial,
  ValidationError, ValidityPeriod, canonicalJson, contentHash,
} from "./models.js";
export type { Deviation, Json, JsonObject, SeverityAssumption, ThreatSpec } from "./models.js";
export { DEFAULT_PRECEDENCE, MECHANISMS, gradeMechanisms, mutatingActions } from "./mechanisms.js";
export type { Mechanism, MechanismOptions } from "./mechanisms.js";
export { mechanismColumn, outcomeColumn } from "./columns.js";
export type { MechanismColumn, OutcomeColumn } from "./columns.js";
export { DEFAULT_RULERS, Ruler, accuracy, agreementWithGrader, applyRulers, interRaterReliability, krippendorffAlpha, passPowerK, pathConsistency, rate } from "./rulers.js";
export type { RulerResult } from "./rulers.js";
export { FunctionImplementation, controlFunctions, datasetDistribution, measure, observationRows, trialSeed } from "./runner.js";
export { TraceRecorder } from "./tracing.js";
export { selfValidate } from "./validation.js";
export type { Check, ValidationEvidence } from "./validation.js";
export { selectAudit, auditDrift } from "./audit.js";

export const VERSION = "0.5.0";
