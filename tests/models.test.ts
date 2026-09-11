import assert from "node:assert/strict";
import { test } from "node:test";
import { EnvironmentDefinition, Function, Measurement, ModelIdentity, Scenario, ValidationError, contentHash } from "../src/index.js";
import { demoDefinition } from "../src/examples.js";
import { fixtures } from "./fixtures.js";

test("function identity is only the system under test", () => {
  const fn = demoDefinition();
  for (const update of [{ prompts: ["different"] }, { implementation: { revision: "2" } }, { configuration: { temperature: 0 } }, { model: fn.model!.with({ version: "2" }) }]) {
    assert.notEqual(fn.with(update as never).id, fn.id);
  }
  assert.equal(fn.with({ name: "renamed" }).id, fn.id);
  assert.deepEqual(Object.keys(fn.componentHashes).sort(), ["configuration", "implementation", "models", "prompts"]);
});

test("environment is external to the function", () => {
  const a = new EnvironmentDefinition({ name: "x", mandate: { amountCap: 1 } });
  const b = new EnvironmentDefinition({ name: "x", mandate: { amountCap: 2 } });
  assert.notEqual(a.id, b.id);
  assert.ok(!("mandate" in demoDefinition()));
});

test("function needs an implementation identity and one model shape", () => {
  assert.throws(() => new Function({ implementation: {} }), ValidationError);
  assert.throws(() => new Function({ implementation: { revision: "1" }, model: new ModelIdentity({ provider: "p", name: "m", version: "1" }),
    models: [new ModelIdentity({ provider: "p", name: "m", version: "2" })] }), ValidationError);
});

test("nested data is frozen and labels are free strings", async () => {
  const { scenario } = await fixtures();
  assert.throws(() => { (scenario.state.documents as Record<string, unknown>[])[0].amount = "1"; }, TypeError);
  assert.throws(() => { (scenario as { id: string }).id = "other"; }, TypeError);
  const relabelled = scenario.with({ label: "tier-2" });
  assert.equal(relabelled.label, "tier-2");
  assert.throws(() => new Scenario({ id: "x", input: {}, label: "", groundState: {}, cluster: "c" }), ValidationError);
});

test("moving model aliases are rejected", () => {
  for (const version of ["latest", "default", "auto", "current", ""]) {
    assert.throws(() => new ModelIdentity({ provider: "provider", name: "model", version }), ValidationError);
  }
});

test("snapshot round trip preserves identity", async () => {
  const { measurement } = await fixtures();
  const restored = Measurement.fromJSON(JSON.parse(JSON.stringify(measurement)));
  assert.equal(restored.id, measurement.id);
  assert.equal(restored.bindingId, measurement.bindingId);
  assert.equal(contentHash(restored.toPlain(false)), contentHash(measurement.toPlain(false)));
});

test("incomplete crossings and seed mismatches are rejected", async () => {
  const { measurement } = await fixtures();
  assert.throws(() => measurement.with({ trials: measurement.trials.slice(0, -1) }), /complete crossed/);
  const changed = measurement.trials[0].with({ seed: 999999 });
  assert.throws(() => measurement.with({ trials: [changed, ...measurement.trials.slice(1)] }), /same seeds/);
  assert.throws(() => measurement.with({ controlIds: ["missing"] }), /Control identities/);
});
