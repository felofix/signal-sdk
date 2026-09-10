---
title: Introduction
group: Get started
summary: What Signal measures, in one screen.
---

Signal is a statistical measuring instrument for agent systems. You give it a **function** (the thing under test), a **book** of scenarios (constructed test examples with a ground state), and a **domain** (the external world: tools, enforcement, graders). It runs every function on every scenario several times, grades each trial deterministically, and reads **rulers** off the results: accuracy with a 95% interval, pass^k, cost, harm rates, agreement between raters.

Nothing about a task domain lives in the core. Documents, payments, tool schemas and harm definitions are supplied by a `Domain`. The built-in one grades plain return values, so any callable — sync or async — is measurable in a few lines. The whole SDK is TypeScript for Node 20+ with no runtime dependencies; the statistics are implemented and tested in-repo.

## Example

```ts
import { Function, FunctionImplementation, Scenario, datasetDistribution, runExperiment } from "signal-sdk";

const words = ["signal", "measure", "scenario", "trial", "grader", "loss"];
const book = words.map((w, i) => new Scenario({
  id: `t${i}`, input: { task: `Uppercase: ${w}` }, label: "easy",
  groundState: { value: w.toUpperCase() }, cluster: `g${Math.floor(i / 3)}`,
}));
const distribution = datasetDistribution("Uppercase words", book, { labelRule: "all easy", topCluster: "group" });

const upper = (context: { input: { task: string } }) => context.input.task.replace("Uppercase: ", "").toUpperCase();

const experiment = await runExperiment("uppercase",
  [new FunctionImplementation(new Function({ name: "upper", implementation: { revision: "1" } }), upper, "simulation")],
  distribution, book, { repetitions: 2 });
console.log(experiment.table());
```

```text
| Function                  | accuracy             | fieldF1              | pass^k               | ...
|---------------------------|----------------------|----------------------|----------------------|
| upper                     | 1.000 [0.541, 1.000] | 1.000 [0.541, 1.000] | 1.000 [0.541, 1.000] |
| never_escalate (control)  | 0.000 [0.000, 0.459] | 0.000 [0.000, 0.459] | 0.000 [0.000, 0.459] |
| always_escalate (control) | 0.000 [0.000, 0.459] | 0.000 [0.000, 0.459] | 0.000 [0.000, 0.459] |
```

## Three columns, never one number

| Column | What it holds |
|---|---|
| **Outcome** | Correct final state against the ground state, field-level F1 as support, escalation when it was required. |
| **Events** | Per harm class: was it *attempted*, did it *occur*, and at what severity. A mandate can stop an occurrence without erasing the attempt. |
| **Process** | Schema validity, steps, retries, actual tokens and cost, latency, the tool-call path signature. |

Rulers read any of these, plus custom `metrics` and `ratings` a domain or judge attaches. They are never summed into a composite score.

## What it is not

There is no language model grading anything inside the SDK. A judge can be attached as a *rater* after the fact, and its reliability against the deterministic grader is itself a ruler. There is no router: the calibration curve is as far as the measurement goes.
