/** Repeatable simulation checks that must pass before measurement execution. */

import { performance } from "node:perf_hooks";
import { type Json, type JsonObject, contentHash, deepFreeze, plain } from "./models.js";
import { calibrate } from "./statistics/calibration.js";
import { type Row, compare, interval } from "./statistics/core.js";
import { difficulty } from "./statistics/difficulty.js";
import { expit, proportionInterval, spearman } from "./statistics/dist.js";
import { lossDistribution } from "./statistics/loss.js";
import { Rng } from "./statistics/random.js";

export function syntheticRow(scenario: number, fn: string, repetition: number, cluster: number, correct: boolean, harm: boolean,
  options: { label?: string; cost?: number } = {}): Row {
  return {
    scenarioId: String(scenario), functionId: fn, repetition, seed: scenario * 10 + repetition, cluster: String(cluster), label: options.label ?? "easy",
    correct, fieldF1: correct ? 1 : 0, requiredEscalationMet: null, ratings: {}, schemaValid: true, steps: 2, retries: 0, tokens: 10, cost: options.cost ?? 0.01,
    latencyMs: 5, pathSignature: correct ? "pay" : "escalate", attempted: { wrong_account: harm }, occurred: { wrong_account: harm },
    severity: { wrong_account: harm ? 10 : 0 }, metrics: {}, riskSignal: harm ? 0.8 : 0.1, variantOf: null, groundStateHash: "", outcomeSignature: "",
    toolFault: false, executionError: null,
  };
}

export interface Check { name: string; status: "PASS" | "FAIL"; [evidence: string]: Json }

function check(name: string, passed: boolean, evidence: Record<string, unknown> = {}): Check {
  return { name, status: passed ? "PASS" : "FAIL", ...(plain(evidence) as JsonObject) };
}

export function statisticalChecks(seed = 1729): Check[] {
  const rng = new Rng(seed);
  const checks: Check[] = [];
  let covered = 0;
  const simulations = 150;
  for (let simulation = 0; simulation < simulations; simulation++) {
    const values: number[] = [], clusters: string[] = [];
    for (let c = 0; c < 40; c++) {
      const probability = rng.beta(0.2 * 5, 0.8 * 5);
      for (let k = 0; k < 4; k++) { values.push(rng.next() < probability ? 1 : 0); clusters.push(String(c)); }
    }
    const estimate = interval(values, clusters, { samples: 300, seed: seed + simulation, bounds: [0, 1] });
    if ((estimate.interval[0] as number) <= 0.2 && 0.2 <= (estimate.interval[1] as number)) covered++;
  }
  const monteCarlo = proportionInterval(covered, simulations);
  checks.push(check("cluster_interval_coverage", covered / simulations >= 0.9, { plantedRate: 0.2, nominalCoverage: 0.95, simulatedCoverage: covered / simulations,
    monteCarloInterval: monteCarlo, simulations, acceptanceMinimum: 0.9 }));

  let falsePasses = 0;
  const simulationsNi = 100;
  for (let simulation = 0; simulation < simulationsNi; simulation++) {
    const rows: Row[] = [];
    for (let e = 0; e < 100; e++) {
      const u = rng.next();
      for (const [fn, probability] of [["reference", 0.03], ["worse", 0.3]] as const) rows.push(syntheticRow(e, fn, 0, Math.floor(e / 2), u >= probability, u < probability));
    }
    const report = compare(rows, "reference", "worse", { bootstrapSamples: 300, seed: simulation,
      comparisons: [{ name: "wrong_account_loss", metric: "loss:wrong_account", margin: 1000, maximumSeverity: 10, confirmatory: true }] });
    if (report.comparisons[0].conclusion === "non_inferior") falsePasses++;
  }
  checks.push(check("worse_function_rejected", falsePasses <= 5, { falseNoninferiorityConclusions: falsePasses, simulations: simulationsNi,
    marginCurrencyPer10000: 1000, plantedExcessLossPer10000: 27000 }));

  const zero = interval(new Array(100).fill(0), Array.from({ length: 100 }, (_, i) => String(Math.floor(i / 5))), { bounds: [0, 1], samples: 300 });
  checks.push(check("zero_events_not_zero_risk", (zero.interval[1] as number) > 0 && Boolean(zero.zeroEventNote), { upperBound: zero.interval[1] }));

  const rows: Row[] = [];
  const planted = Array.from({ length: 48 }, () => rng.normal(0, 1.5));
  planted.forEach((value, e) => {
    const label = e % 3 === 0 ? "easy" : e % 3 === 1 ? "complex" : "impossible";
    for (const [fn, ability] of [["f0", -0.5], ["f1", 0.5], ["f2", 1.5]] as const) {
      for (let repetition = 0; repetition < 4; repetition++) {
        const correct = rng.next() < expit(ability - value);
        rows.push(syntheticRow(e, fn, repetition, Math.floor(e / 3), correct, !correct, { label }));
      }
    }
  });
  const model = difficulty(rows, { seed, draws: 300 });
  const correlations: number[] = [];
  for (const result of Object.values(model.empiricalDifficulty)) {
    if (result.status === "estimated") {
      const predicted = planted.map((_, e) => result.scenarios![String(e)]);
      correlations.push(spearman(planted, predicted));
    }
  }
  checks.push(check("difficulty_recovers_planted_order", correlations.length === 3 && Math.min(...correlations) > 0.5,
    { leaveFunctionOutCorrelations: correlations, acceptanceMinimum: 0.5, fitStatus: model.status, reason: model.reason ?? null }));
  const widths = Object.values(model.predictions).map((p) => p.predictionWiderThanMeasuredInterval);
  checks.push(check("future_prediction_wider", widths.length === 3 && widths.every(Boolean), { perFunctionPass: widths }));

  const calibration = calibrate(rows, { functionId: "f0", seed, bootstrapSamples: 300 });
  const split = calibration.split;
  checks.push(check("calibration_cluster_separation", calibration.status === "estimated" && !!split && !split.trainingClusters.some((c) => split.testClusters.includes(c)),
    { split: split ?? null }));

  const lossRows = Array.from({ length: 100 }, (_, e) => syntheticRow(e, "f0", 0, e, e % 5 !== 0, e % 5 === 0));
  const loss = lossDistribution(lossRows, { functionId: "f0", simulations: 1000, seed,
    severityAssumptions: { wrong_account: { distribution: "fixed", amount: 10, currency: "USD" } } });
  const bounds = loss.harms.wrong_account.expectedLossInterval!;
  checks.push(check("loss_recovers_planted_mean", bounds[0] <= 20000 && 20000 <= bounds[1], { plantedLossPer10000: 20000, expectedLossInterval: bounds }));
  return checks;
}

async function controlCheck(): Promise<Check> {
  const { broadMandate, generateBook, paymentsDomain } = await import("./domains/payments/index.js");
  const { controlFunctions, execute } = await import("./runner.js");
  const { distribution: _distribution, scenarios } = generateBook(40, { seed: 23, vendors: 10, hazardRates: { bank_detail_change: 0.4 }, impossibleRate: 0.2 });
  const domain = paymentsDomain(broadMandate(scenarios));
  const results: Record<string, Awaited<ReturnType<typeof execute>>[]> = {};
  for (const control of controlFunctions(domain)) {
    results[control.definition.name] = [];
    for (const scenario of scenarios) results[control.definition.name].push(await execute(control, scenario, 0, 0, domain));
  }
  const harm = (name: string, key: string) => results[name].reduce((sum, trial) => sum + trial.grades.events.filter((e) => e.harm === key && e.attempted).length, 0);
  const payWrong = harm("always_pay", "wrong_account"), escalateWrong = harm("always_escalate", "wrong_account");
  const payUnnecessary = harm("always_pay", "unnecessary_escalation"), escalateUnnecessary = harm("always_escalate", "unnecessary_escalation");
  const easy = scenarios.map((t, i) => ((t.groundState.payments as unknown[]).length ? i : -1)).filter((i) => i >= 0);
  const separates = payWrong > escalateWrong && escalateUnnecessary > payUnnecessary &&
    easy.some((i) => results.always_pay[i].grades.outcome.correct && !results.always_escalate[i].grades.outcome.correct);
  return check("controls_separated", separates, { alwaysPayWrongAccountAttempts: payWrong, alwaysEscalateWrongAccountAttempts: escalateWrong,
    alwaysEscalateUnnecessaryEscalations: escalateUnnecessary });
}

export interface ValidationEvidence { status: "PASS" | "FAIL"; suiteVersion: string; seed: number; checks: Check[]; elapsedSeconds: number; scope: string; evidenceId: string }

const cache = new Map<number, Promise<ValidationEvidence>>();

async function computeValidation(seed: number): Promise<ValidationEvidence> {
  const start = performance.now();
  const checks = statisticalChecks(seed);
  checks.push(await controlCheck());
  const result = {
    status: checks.every((c) => c.status === "PASS") ? "PASS" : "FAIL", suiteVersion: "signal-self-validation-v1", seed, checks,
    elapsedSeconds: (performance.now() - start) / 1000,
    scope: "Finite seeded simulations check selected statistical regimes; passing is not universal statistical validation.",
  } as Omit<ValidationEvidence, "evidenceId">;
  return deepFreeze({ ...result, evidenceId: contentHash(result) });
}

/** Return a fresh copy of cached evidence; callers cannot mutate the gate. */
export async function selfValidate(seed = 1729): Promise<ValidationEvidence> {
  if (!cache.has(seed)) cache.set(seed, computeValidation(seed));
  return JSON.parse(JSON.stringify(await cache.get(seed)!)) as ValidationEvidence;
}
