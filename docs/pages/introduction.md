---
title: Introduction
group: Get started
summary: What Signal measures, in one screen.
---

Signal is a statistical measuring instrument for agent systems. You give it a **function** (the thing under test), a **book** of scenarios (constructed test examples, each with a threat class and a ground state), and a **environment** (the external world: tools, enforcement, graders). It runs every function on every scenario several times, grades each trial deterministically, and reads **rulers** off the results: accuracy with a 95% interval, pass^k, cost, deviation rates, agreement between raters.

Nothing about an environment lives in the core. Documents, payments, tool schemas and threat definitions are supplied by an `Environment`. The built-in one grades plain return values, so any callable — sync or async — is measurable in a few lines. The whole SDK is TypeScript for Node 20+ with no runtime dependencies; the statistics are implemented and tested in-repo.

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

## Two columns, never one number

Signal is arranged as a bow-tie: threats on the left, the top event in the knot, consequences on the right. It measures the knot first.

| Column | What it holds |
|---|---|
| **Outcome** | Per threat: is the final state the ground state? A wrong outcome carries one canonical deviation (`wrong_action`, `wrong_value`, `missing_action`, `extra_action`). Attempted deviation is read from emitted actions, occurred deviation from the final state; their difference is what the mandate caught. |
| **Mechanism** | Per threat, on wrong outcomes only: why. `injection_followed`, `compaction_loss`, `hallucination`, `tool_fault_mishandled`, or the residual `misinterpretation`, with exactly one primary chosen by a stated precedence. `mandate_attempt` is recorded on every trial because the barrier made those outcomes correct. |

Process (steps, retries, tokens, cost, latency, path) rides along, and rulers read any of it plus custom `metrics` and `ratings`. Loss is a separate section rendered only when you supply a severity table. Nothing is summed into a composite score.

## What it is not

There is no language model grading anything inside the SDK. A judge can be attached as a *rater* after the fact, and its reliability against the deterministic grader is itself a ruler. There is no router: the calibration curve is as far as the measurement goes.
