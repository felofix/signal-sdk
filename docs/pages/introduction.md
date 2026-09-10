---
title: Introduction
group: Get started
summary: What Signal measures, in one screen.
---

Signal is a statistical measuring instrument for agent systems. You give it a **function** (the thing under test), a **book** of trajectories (constructed tasks with ground truth), and a **domain** (the external world: tools, enforcement, graders). It runs every function on every trajectory several times, grades each trial deterministically, and reads **rulers** off the results: accuracy with a 95% interval, pass^k, cost, harm rates, agreement between raters.

Nothing about a task domain lives in the core. Documents, payments, tool schemas and harm definitions are supplied by a `Domain`. The built-in one grades plain return values, so any Python callable is measurable in a few lines.

## Example

```python
from signal_sdk import Trajectory, Function, FunctionImplementation, dataset_distribution, run_experiment

book = tuple(
    Trajectory(id=f"t{i}", input={"task": f"Uppercase: {w}"}, label="easy",
               ground_truth={"value": w.upper()}, cluster=f"g{i // 3}")
    for i, w in enumerate(["signal", "measure", "trajectory", "trial", "grader", "loss"])
)
distribution = dataset_distribution("Uppercase words", book, label_rule="all easy", top_cluster="group")

def upper(context):
    return context.input["task"].removeprefix("Uppercase: ").upper()

experiment = run_experiment(
    "uppercase",
    (FunctionImplementation(Function(name="upper", implementation={"revision": "1"}), upper, kind="simulation"),),
    distribution, book, repetitions=2,
)
print(experiment.table())
```

```text
| Function                  | accuracy             | field_f1             | pass^k               | ...
|---------------------------|----------------------|----------------------|----------------------|
| upper                     | 1.000 [0.541, 1.000] | 1.000 [0.541, 1.000] | 1.000 [0.541, 1.000] |
| never_escalate (control)  | 0.000 [0.000, 0.459] | 0.000 [0.000, 0.459] | 0.000 [0.000, 0.459] |
| always_escalate (control) | 0.000 [0.000, 0.459] | 0.000 [0.000, 0.459] | 0.000 [0.000, 0.459] |
```

## Three columns, never one number

| Column | What it holds |
|---|---|
| **Outcome** | Correct final state against ground truth, field-level F1 as support, escalation when it was required. |
| **Events** | Per harm class: was it *attempted*, did it *occur*, and at what severity. A mandate can stop an occurrence without erasing the attempt. |
| **Process** | Schema validity, steps, retries, actual tokens and cost, latency, the tool-call path signature. |

Rulers read any of these, plus custom `metrics` and `ratings` a domain or judge attaches. They are never summed into a composite score.

## What it is not

There is no language model grading anything inside the SDK. A judge can be attached as a *rater* after the fact, and its reliability against the deterministic grader is itself a ruler. There is no router: the calibration curve is as far as the measurement goes.
