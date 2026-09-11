---
title: Quickstart
group: Get started
summary: Measure a callable end to end and read the certificate.
---

Four steps: build a book, identify the function, measure, report. The default environment has no tools except `escalate()`, and the outcome is whatever the function returns.

## Example

```ts
import { Function, FunctionImplementation, MeasurementConfig, Scenario, datasetDistribution, measure } from "@felofix/signal-sdk";
import { exportCertificates } from "@felofix/signal-sdk/certificate";
import { exportHtml } from "@felofix/signal-sdk/visualization";

// 1. The book. Labels are yours; write the rule down. The ground state says what should be true afterwards.
const pairs = [[42, 20], [7, 35], [18, 3], [61, 9], [14, 14], [99, 1]];
const book = pairs.map(([a, b], i) => {
  const missing = i % 3 === 2;
  return new Scenario({
    id: `sum-${i}`, input: { task: `What is ${a} + ${missing ? "?" : b}?` },
    label: missing ? "missing-operand" : "plain",
    groundState: { value: missing ? null : a + b, escalated: missing },
    cluster: `batch-${Math.floor(i / 2)}`,
  });
});
const distribution = datasetDistribution("Sums", book, { topCluster: "batch",
  labelRule: "missing-operand if an operand is '?', otherwise plain" });

// 2. The function: what it is, not what it can touch.
function add(context: { input: { task: string }; tools: { escalate(reason?: string): unknown } }): number | null {
  const task = context.input.task;
  if (task.includes("+ ?")) { context.tools.escalate("Missing operand"); return null; }
  const [a, b] = task.replace("What is ", "").replace("?", "").split(" + ");
  return Number(a) + Number(b);
}
const fn = new Function({ name: "add", implementation: { module: "quickstart", callable: "add", revision: "1" } });

// 3. Measure. Two trivial controls are added for you.
const measurement = await measure([new FunctionImplementation(fn, add, "simulation")], distribution, book,
  { config: new MeasurementConfig({ mode: "simulation", repetitions: 3, seed: 7 }) });

// 4. Report.
exportCertificates(measurement, "outputs/quickstart/certificates");
exportHtml(measurement, "outputs/quickstart/traces.html");
console.log(measurement.id, measurement.trials.length, "trials");
```

```text
03de7442ffdf9a5b1c… 54 trials
```

## What you get

- `outputs/quickstart/certificates/<function-id>.md` and `.json`: one risk certificate per function, including the two controls.
- `outputs/quickstart/traces.html`: an offline trace explorer with goals, tool calls, tokens, cost and latency for every trial.
- `measurement`: an immutable, content-addressed `Measurement`. `JSON.stringify(measurement)` is the snapshot; `Measurement.fromJSON()` restores it with the same `id`.

## For a real model

Use `kind: "real"` and `MeasurementConfig({ mode: "real" })`, and record actual usage from inside the function:

```ts
async function run(context: TrialContext<ReturnValueTools>) {
  const started = performance.now();
  const response = await client.messages.create({ model: MODEL, max_tokens: 100, messages: [{ role: "user", content: (context.input as { task: string }).task }] });
  context.trace.recordUsage({ tokens: response.usage.input_tokens + response.usage.output_tokens, cost: null,
    durationMs: performance.now() - started, metadata: { providerVersion: response.model } });
  return response.content[0].text;
}
```

`providerVersion` must match the pinned `ModelIdentity.version` on the function, otherwise the trial is recorded as an error and the certificate is marked `invalid_provider_version`. Missing cost stays `null`, never zero.
