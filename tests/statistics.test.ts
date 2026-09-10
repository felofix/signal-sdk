import assert from "node:assert/strict";
import { test } from "node:test";
import { observationRows } from "../src/runner.js";
import { calibrate, compare, detectDrift, detectableDifference, interval, lossDistribution, robustness, sampleSize, summarize } from "../src/statistics/index.js";
import { normPpf, proportionInterval, quantile, spearman, tPpf } from "../src/statistics/dist.js";
import { Rng } from "../src/statistics/random.js";
import { selfValidate, syntheticRow } from "../src/validation.js";
import { fixtures } from "./fixtures.js";

const rows = () => Array.from({ length: 40 }, (_, e) => e).flatMap((e) => ["a", "b"].flatMap((f) => [0, 1].map((r) => syntheticRow(e, f, r, Math.floor(e / 4), e % 5 !== 0, e % 5 === 0))));

test("distribution functions match reference values", () => {
  assert.ok(Math.abs(normPpf(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(tPpf(0.975, 5) - 2.570582) < 1e-4);
  assert.ok(Math.abs(tPpf(0.975, 1e7) - 1.959964) < 1e-4);
  assert.deepEqual(quantile([1, 2, 3, 4], 0.5), 2.5);
  const [low, high] = proportionInterval(140, 150);
  assert.ok(low > 0.87 && low < 0.89 && high > 0.96 && high < 0.97);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
});

test("the seeded generator is deterministic and its distributions have the right moments", () => {
  const a = new Rng(42), b = new Rng(42);
  assert.deepEqual([a.next(), a.normal(), a.integer(0, 10)], [b.next(), b.normal(), b.integer(0, 10)]);
  const rng = new Rng(7);
  const gammas = Array.from({ length: 20000 }, () => rng.gamma(3, 2));
  assert.ok(Math.abs(gammas.reduce((s, v) => s + v, 0) / gammas.length - 6) < 0.15);
  const binomials = Array.from({ length: 5000 }, () => rng.binomial(1000, 0.3));
  assert.ok(Math.abs(binomials.reduce((s, v) => s + v, 0) / binomials.length - 300) < 2);
  const betas = Array.from({ length: 20000 }, () => rng.beta(2, 6));
  assert.ok(Math.abs(betas.reduce((s, v) => s + v, 0) / betas.length - 0.25) < 0.01);
});

test("zero events use clusters, not repetitions", () => {
  const ci = interval(new Array(100).fill(0), Array.from({ length: 100 }, (_, i) => String(Math.floor(i / 10))), { samples: 200, bounds: [0, 1] });
  assert.ok((ci.interval[1] as number) > 0.03);
  assert.match(ci.zeroEventNote!, /3\/n/);
  assert.equal(ci.scenarios, 100);
  assert.equal(ci.clusters, 10);
});

test("crossing rejects unpaired seeds", () => {
  const data = rows();
  data[0].seed = 99999;
  assert.throws(() => compare(data, "a", "b"), /same scenarios/);
});

test("non-inferiority is strict, family-wise, and needs a severity bound", () => {
  const strict = compare(rows(), "a", "b", { comparisons: [{ name: "same", metric: "loss:wrong_account", margin: 0, maximumSeverity: 10, confirmatory: true }], familySize: 4, bootstrapSamples: 200 });
  assert.equal(strict.comparisons[0].conclusion, "not_established");
  assert.equal(strict.comparisons[0].advantage.confidence, 0.9875);
  const unbounded = compare(rows(), "a", "b", { comparisons: [{ name: "same", metric: "loss:wrong_account", margin: 100, confirmatory: true }], bootstrapSamples: 200 });
  assert.equal(unbounded.comparisons[0].conclusion, "not_established");
});

test("pass^k is all repetitions, not at least one", () => {
  const data = rows().map((r) => ({ ...r, correct: r.repetition === 0 }));
  const stats = summarize(data, { bootstrapSamples: 200 });
  assert.equal(stats.functions.a.outcome.correct.estimate, 0.5);
  assert.equal(stats.functions.a.consistency.passPowerK.estimate, 0);
});

test("power planning respects the cluster design effect", () => {
  const small = sampleSize(1000, 2, { clusterSize: 10, icc: 0 });
  const clustered = sampleSize(1000, 2, { clusterSize: 10, icc: 0.5 });
  assert.ok(clustered.scenarios > small.scenarios);
  assert.ok(detectableDifference(small.scenarios, 2).detectableCurrencyPer10000 <= 1000);
});

test("calibration fits on training clusters only", () => {
  const data = rows();
  const fit = calibrate(data, { functionId: "a", seed: 3, bootstrapSamples: 200 });
  assert.equal(fit.status, "estimated");
  const testClusters = new Set(fit.split!.testClusters);
  assert.ok(!fit.split!.trainingClusters.some((c) => testClusters.has(c)));
  for (const row of data) if (testClusters.has(row.cluster)) row.severity.wrong_account = 10000;
  assert.equal(calibrate(data, { functionId: "a", seed: 3, bootstrapSamples: 200 }).chosenThreshold, fit.chosenThreshold);
});

test("loss keeps zero-event uncertainty", () => {
  const data = rows().map((r) => ({ ...r, occurred: { wrong_account: false } }));
  const result = lossDistribution(data, { functionId: "a", simulations: 200, severityAssumptions: { wrong_account: { amount: 100, currency: "USD" } } });
  assert.ok(result.harms.wrong_account.p95! > 0);
});

test("variants stay out of the main denominator", async () => {
  const { measurement } = await fixtures();
  const primary = observationRows(measurement), all = observationRows(measurement, { includeVariants: true });
  assert.equal(all.length, primary.length * 3);
  const result = robustness(all, { bootstrapSamples: 200 });
  for (const fn of Object.values(result.functions)) {
    assert.equal(fn.originalScenariosWithVariants, 16);
    assert.equal(fn.cosmeticOutcomeChangeFraction!.estimate, 0);
  }
});

test("drift rejects non-audit rows and reopened clusters, and detects degradation", () => {
  assert.throws(() => detectDrift([{ scenarioId: "0", cluster: "a", judgedSafe: true, auditSelected: false, auditProbability: 0.1, humanReviewed: true }], { baselines: { "attempts:wrong_account": 0.1 } }), /audited/);
  const reopened = ["a", "b", "a"].map((c, i) => ({ scenarioId: String(i), cluster: c, auditSelected: true, judgedSafe: true, auditProbability: 0.1, humanReviewed: true, attempted: { wrong_account: true } }));
  assert.throws(() => detectDrift(reopened, { baselines: { "attempts:wrong_account": 0.1 } }), /reopened/);
  const degraded = Array.from({ length: 50 }, (_, i) => ({ scenarioId: String(i), cluster: String(i), auditSelected: true, judgedSafe: true, auditProbability: 0.1, humanReviewed: true, attempted: { wrong_account: true } }));
  assert.equal(detectDrift(degraded, { baselines: { "attempts:wrong_account": 0.1 } }).metrics["attempts:wrong_account"].alarm, true);
});

test("self-validation passes and its cache cannot be mutated", async () => {
  const result = await selfValidate();
  assert.equal(result.status, "PASS");
  (result as { status: string }).status = "FAIL";
  assert.equal((await selfValidate()).status, "PASS");
});
