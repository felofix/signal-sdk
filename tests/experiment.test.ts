import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULERS, Function, FunctionImplementation, MeasurementConfig, agreementWithGrader, datasetDistribution, evaluate, interRaterReliability, krippendorffAlpha, measure, rate, rateTrials, runExperiment } from "../src/index.js";
import { add, arithmeticBook } from "../src/examples.js";

const sloppy = (context: Parameters<typeof add>[0]) => { const r = add(context); return r !== null && r % 7 === 0 ? r + 1 : r; };
const functions = () => [new FunctionImplementation(new Function({ name: "add", implementation: { r: "1" } }), add, "simulation"),
  new FunctionImplementation(new Function({ name: "sloppy", implementation: { r: "2" } }), sloppy, "simulation")];

test("labels are free strings", async () => {
  const { scenarios } = arithmeticBook(6);
  const relabelled = scenarios.map((s, i) => s.with({ label: `tier-${i % 2}` }));
  const distribution = datasetDistribution("relabelled", relabelled, { labelRule: "alternating tiers", topCluster: "batch" });
  const m = await measure(functions().slice(0, 1), distribution, relabelled, { config: new MeasurementConfig({ mode: "simulation", bootstrapSamples: 200, lossSimulations: 200 }) });
  assert.deepEqual([...new Set(m.scenarios.map((s) => s.label))].sort(), ["tier-0", "tier-1"]);
});

test("experiments table variants and pair them against the baseline", async () => {
  const { distribution, scenarios } = arithmeticBook(24);
  const experiment = await runExperiment("adders", functions(), distribution, scenarios, { repetitions: 2, rulers: [...DEFAULT_RULERS, rate("metric:missing")] });
  assert.deepEqual(Object.keys(experiment.results).sort(), ["add", "always_escalate", "never_escalate", "sloppy"]);
  assert.equal(experiment.results.add.accuracy.estimate, 1);
  assert.ok(experiment.results.sloppy.accuracy.estimate! < 1);
  assert.equal(experiment.results.add["metric:missing"].estimate, null);
  assert.deepEqual(Object.keys(experiment.comparisons), ["sloppy"]);
  const advantage = experiment.comparisons.sloppy.comparisons.find((c) => c.name === "accuracy")!.advantage;
  assert.ok(advantage.estimate! < 0 && (advantage.interval[0] as number) < advantage.estimate! && advantage.estimate! < (advantage.interval[1] as number));
  assert.ok(experiment.table().includes("| add |") && experiment.table().includes("(control)"));
  assert.equal((experiment.toJSON() as { baseline: string }).baseline, "add");
});

test("ratings feed inter-rater reliability", async () => {
  const { distribution, scenarios } = arithmeticBook(24);
  const experiment = await runExperiment("judged", functions(), distribution, scenarios, { repetitions: 2 });
  let m = await rateTrials(experiment.measurement, "grader", (_s, trial) => trial.grades.outcome.correct);
  m = await rateTrials(m, "lenient_judge", async (s, trial) => trial.outcome.escalated === Boolean(s.groundState.escalated));
  assert.notEqual(m.id, experiment.measurement.id);
  const judged = evaluate("judged", m, [interRaterReliability(["grader", "lenient_judge"]), agreementWithGrader("lenient_judge")], { baseline: "add" });
  assert.equal(judged.results.add["irr:grader+lenient_judge"].estimate, 1);
  assert.ok(judged.results.sloppy["irr:grader+lenient_judge"].estimate! < 1);
  assert.ok(judged.results.sloppy["agreement:lenient_judge"].estimate! < 1);
  assert.notEqual(judged.results.sloppy["agreement:lenient_judge"].interval[0], null);
});

test("krippendorff alpha known values", () => {
  assert.equal(krippendorffAlpha([["a", "a"], ["b", "b"], ["a", "a"]]), 1);
  assert.ok(krippendorffAlpha([["a", "b"], ["b", "a"]])! < 0);
  assert.equal(krippendorffAlpha([["a"]]), null);
  assert.equal(krippendorffAlpha([["a", "a"], ["a", "a"]]), 1);
});
