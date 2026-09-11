import assert from "node:assert/strict";
import { test } from "node:test";
import { compareMeasurements, limitations } from "../src/certificate.js";
import { RETURN_VALUES } from "../src/environment.js";
import { generateBook, paymentsEnvironment } from "../src/environments/payments/index.js";
import { add, arithmeticBook, arithmeticDemo, demoDefinition, demoMandate, reconcile } from "../src/examples.js";
import { ComparisonPlan, ConfirmatoryComparison, Function, MeasurementConfig, ValidityPeriod } from "../src/models.js";
import { FunctionImplementation, execute, measure } from "../src/runner.js";
import { cleanScenario, fixtures } from "./fixtures.js";

function payments(count = 2) {
  const { distribution, scenarios } = generateBook(count);
  return { distribution, scenarios, environment: paymentsEnvironment(demoMandate(scenarios)) };
}

test("a modified generator book is rejected", async () => {
  const { distribution, scenarios, environment } = payments();
  const changed = scenarios[0].with({ groundState: { payments: [] } });
  await assert.rejects(measure([new FunctionImplementation(demoDefinition(), reconcile, "simulation")], distribution, [changed, ...scenarios.slice(1)], { environment }), /reproduce/);
});

test("a generated book needs a reproducing environment", async () => {
  const { distribution, scenarios } = payments();
  await assert.rejects(measure([new FunctionImplementation(demoDefinition(), reconcile, "simulation")], distribution, scenarios,
    { environment: RETURN_VALUES as never, config: new MeasurementConfig({ mode: "simulation" }) }), /datasetDistribution/);
});

test("modes and kinds must agree", async () => {
  const { distribution, scenarios, environment } = payments();
  await assert.rejects(measure([new FunctionImplementation(demoDefinition(), reconcile)], distribution, scenarios, { environment, config: new MeasurementConfig({ mode: "simulation" }) }), /Real functions/);
  await assert.rejects(measure([new FunctionImplementation(demoDefinition(), reconcile, "simulation")], distribution, scenarios, { environment, config: new MeasurementConfig({ mode: "real" }) }), /Real mode/);
});

test("real functions must record a matching provider version", async () => {
  const scenario = cleanScenario();
  const mismatch = await execute(new FunctionImplementation(demoDefinition(), (ctx) => {
    ctx.trace.recordUsage({ tokens: 10, cost: 0.1, metadata: { providerVersion: "different" } });
    (ctx.tools as { escalate(): unknown }).escalate();
  }), scenario, 0, 0);
  assert.match(mismatch.error!, /provider version/);
  const unreported = await execute(new FunctionImplementation(demoDefinition(), (ctx) => { (ctx.tools as { escalate(): unknown }).escalate(); }), scenario, 0, 0);
  assert.ok(unreported.error);
  assert.equal(unreported.grades.process.tokens, null);
  assert.equal(unreported.grades.process.cost, null);
});

test("an exception keeps completed actions", async () => {
  const trial = await execute(new FunctionImplementation(demoDefinition(), async (ctx) => {
    (ctx.tools as { escalate(): unknown }).escalate();
    throw new Error("after action");
  }, "simulation"), cleanScenario(), 0, 0);
  assert.ok(trial.outcome.escalated && trial.error);
});

test("controls are added and seeds are paired", async () => {
  const { measurement } = await fixtures();
  assert.ok(measurement.functions.map((f) => f.name).includes("always_pay") && measurement.functions.map((f) => f.name).includes("always_escalate"));
  assert.equal(measurement.controlIds.length, 2);
  for (const scenario of measurement.scenarios) {
    for (const repetition of [0, 1]) {
      assert.equal(new Set(measurement.trials.filter((t) => t.scenarioId === scenario.id && t.repetition === repetition).map((t) => t.seed)).size, 1);
    }
  }
});

test("the default environment grades return values and separates its controls", async () => {
  const m = await arithmeticDemo(12, 0, 2);
  const byName = Object.fromEntries(m.functions.map((f) => [f.name, f.id]));
  const correct = (name: string) => m.trials.filter((t) => t.functionId === byName[name]).map((t) => t.grades.outcome.correct);
  assert.ok(correct("add").every(Boolean));
  assert.ok(correct("never_escalate").filter(Boolean).length < correct("never_escalate").length);
  const escalated = correct("always_escalate").filter(Boolean).length;
  assert.ok(escalated > 0 && escalated < correct("always_escalate").length);
  assert.equal(m.environment.name, "return-values");
});

test("validity binds to the measurement", async () => {
  const { distribution, scenarios } = arithmeticBook(6);
  const fn = new Function({ name: "add", implementation: { revision: "1" } });
  const now = Date.now();
  const config = new MeasurementConfig({ mode: "simulation", bootstrapSamples: 200, lossSimulations: 200 });
  await assert.rejects(measure([new FunctionImplementation(fn, add, "simulation")], distribution, scenarios,
    { config, validity: new ValidityPeriod({ start: new Date(now + 86400000).toISOString(), end: new Date(now + 2 * 86400000).toISOString() }) }), /validity period/);
  const m = await measure([new FunctionImplementation(fn, add, "simulation")], distribution, scenarios,
    { config, validity: new ValidityPeriod({ start: new Date(now - 86400000).toISOString(), end: new Date(now + 2 * 86400000).toISOString() }) });
  assert.ok(m.validity && limitations(m, fn.id).join(" ").includes("during"));
});

test("limitations are generated from the configuration", async () => {
  const { measurement } = await fixtures();
  const text = limitations(measurement, measurement.functions[0].id).join(" ");
  for (const phrase of ["Severity is assumed", "lower bound", "model update at the provider invalidates", measurement.distribution.id, measurement.environment.id]) assert.ok(text.includes(phrase), phrase);
});

test("pre/post needs a bound plan and the same environment", async () => {
  const { measurement } = await fixtures();
  assert.throws(() => compareMeasurements(measurement, measurement), /predeclared/);
  const fid = measurement.functions[0].id;
  const plan = new ComparisonPlan({ declaredAt: new Date(Date.parse(measurement.timestamp) - 1000).toISOString(),
    comparisons: [new ConfirmatoryComparison({ name: "same_book", referenceId: fid, candidateId: fid, metric: "correct", margin: 0.1 })] });
  const pre = measurement.with({ config: measurement.config.with({ prepostPlan: plan }) });
  const post = pre.with({ timestamp: new Date().toISOString() });
  const result = compareMeasurements(pre, post) as { pairedDifferences: { comparisonKind: string }[] };
  assert.equal(result.pairedDifferences[0].comparisonKind, "same_function_two_measurements");
  assert.throws(() => compareMeasurements(pre, post.with({ environment: post.environment.with({ name: "other" }) })), /same environment/);
});
