/** Paired, clustered analyses. No composite score or model-based grading. */

export { compare, detectableDifference, estimateMetric, interval, metricValue, sampleSize, summarize, scenarioGroups, validateRows } from "./core.js";
export type { CompareResult, ComparisonReport, ComparisonSpec, Estimate, FunctionSummary, HarmSummary, Row, Rows } from "./core.js";
export { calibrate, robustness } from "./calibration.js";
export type { CalibrationResult, RobustnessResult } from "./calibration.js";
export { detectDrift } from "./drift.js";
export type { AuditRow, DriftResult } from "./drift.js";
export { lossDistribution } from "./loss.js";
export type { HarmLoss, LossResult } from "./loss.js";
export { difficulty } from "./difficulty.js";
export type { DifficultyResult } from "./difficulty.js";
export { Rng, systemRandom } from "./random.js";
export { expit, mean, median, normCdf, normPpf, proportionInterval, quantile, spearman, tPpf, variance } from "./dist.js";
