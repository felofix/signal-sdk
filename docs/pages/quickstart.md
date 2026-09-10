---
title: Quickstart
group: Get started
summary: Measure a callable end to end and read the certificate.
---

Four steps: build a book, identify the function, measure, report. The default domain has no tools except `escalate()`, and the outcome is whatever the function returns.

## Example

```python
from pathlib import Path
from signal_sdk import (Trajectory, Function, FunctionImplementation, MeasurementConfig,
                        dataset_distribution, measure)
from signal_sdk.certificate import export_certificates
from signal_sdk.visualization import export_html

# 1. The book. Labels are yours; write the rule down.
book = []
for i, (a, b) in enumerate([(42, 20), (7, 35), (18, 3), (61, 9), (14, 14), (99, 1)]):
    missing = i % 3 == 2
    book.append(Trajectory(
        id=f"sum-{i}", input={"task": f"What is {a} + {'?' if missing else b}?"},
        label="missing-operand" if missing else "plain",
        ground_truth={"value": None if missing else a + b, "escalated": missing},
        cluster=f"batch-{i // 2}",
    ))
book = tuple(book)
distribution = dataset_distribution("Sums", book, top_cluster="batch",
                                    label_rule="missing-operand if an operand is '?', otherwise plain")

# 2. The function: what it is, not what it can touch.
def add(context):
    task = context.input["task"]
    if "+ ?" in task:
        context.tools.escalate(reason="Missing operand")
        return None
    a, b = task.removeprefix("What is ").rstrip("?").split(" + ")
    return int(a) + int(b)

function = Function(name="add", implementation={"module": "quickstart", "callable": "add", "revision": "1"})

# 3. Measure. Two trivial controls are added for you.
measurement = measure((FunctionImplementation(function, add, kind="simulation"),), distribution, book,
                      config=MeasurementConfig(mode="simulation", repetitions=3, seed=7))

# 4. Report.
export_certificates(measurement, Path("outputs/quickstart/certificates"))
export_html(measurement, Path("outputs/quickstart/traces.html"))
print(measurement.id, len(measurement.trials), "trials")
```

```text
fcd296617f71c5a9f8bb938c38533da99c916c2718a7102d93b9265589cd4729 54 trials
```

## What you get

- `outputs/quickstart/certificates/<function-id>.md` and `.json`: one risk certificate per function, including the two controls.
- `outputs/quickstart/traces.html`: an offline trace explorer with goals, tool calls, tokens, cost and latency for every trial.
- `measurement`: an immutable, content-addressed `Measurement`. `measurement.model_dump_json()` is the snapshot.

## For a real model

Use `kind="real"` and `MeasurementConfig(mode="real")`, and record actual usage from inside the function:

```python
def run(context):
    response = client.responses.create(model=MODEL, input=context.input["task"])
    context.trace.record_usage(tokens=response.usage.total_tokens, cost=None,
                               duration_ms=latency_ms, metadata={"provider_version": response.model})
    return response.output_text
```

`provider_version` must match the pinned `ModelIdentity.version` on the function, otherwise the trial is recorded as an error and the certificate is marked `invalid_provider_version`. Missing cost stays `None`, never zero.
