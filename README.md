<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo.svg" alt="signal" width="96">
  </picture>
</p>

<h1 align="center">Signal SDK</h1>

<p align="center">A statistical measuring instrument for agent systems.<br>
Deterministic graders · paired, clustered statistics · risk certificates</p>

<p align="center"><img src="docs/assets/hero.jpg" alt="" width="100%"></p>

Signal runs a precisely identified **function** (the system under test) against a
constructed **book** of episodes inside an external **environment**, grades every
trial with deterministic graders, and reports three separate columns: **outcome**,
**events**, **process**. They are never summed into one number.

Nothing about the task domain lives in the core. Documents, tools, mandates and
harm definitions are supplied by a `Domain`; the built-in default grades plain
return values, and an optional invoice-payment domain shows a tool-using,
adversarial setup with a tool-enforced mandate.

**[Worked example with real numbers →](https://felofix.github.io/signal-sdk/)**

## Run It

Python 3.11 or newer:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
signal-sdk validate                                    # simulation gate, PASS/FAIL per check
signal-sdk demo --generic --output outputs/generic     # default domain, arithmetic book
signal-sdk demo --output outputs/payments              # payments domain, injected hazards
```

Both demos run without provider calls and add the domain's two trivial controls.
Open `traces.html` in the output folder for goals, tool calls, cost, tokens and
latency; read the Markdown and JSON certificates in `certificates/`.

Measuring your own callable takes a book, a `Function` identity and a call:

```python
from signal_sdk import Episode, Function, FunctionImplementation, Label, MeasurementConfig, dataset_distribution, measure

episodes = tuple(Episode(id=f"e{i}", input={"task": f"Uppercase: {w}"}, label=Label.EASY,
                         ground_truth={"value": w.upper()}, cluster=f"g{i // 3}")
                 for i, w in enumerate(["signal", "measure", "episode", "trial", "grader", "loss"]))
distribution = dataset_distribution("Uppercase words", episodes, label_rule="all easy", top_cluster="group")

def upper(context):
    return context.input["task"].removeprefix("Uppercase: ").upper()

function = Function(name="upper", implementation={"module": "my_agent", "revision": "abc123"})
measurement = measure((FunctionImplementation(function, upper, kind="simulation"),), distribution, episodes,
                      config=MeasurementConfig(mode="simulation", repetitions=2))
```

See [examples/return_values.py](examples/return_values.py) and
[examples/paired_comparison.py](examples/paired_comparison.py).

## Read the Guide

1. [SDK walkthrough](docs/README.md): concepts, domains, construction, execution, reports.
2. [Statistics](docs/statistics.md): estimands, intervals, pairing, difficulty, loss, calibration, drift.
3. [API reference](docs/api.md): public types, `Domain`, tool schemas, CLI and dashboard endpoints.
4. [Specification map](docs/specification.md): what is implemented and its limits.
5. [Release guide](docs/releasing.md): package checks and the separate PyPI publication step.

## Scope

The measurement core includes cluster bootstrap intervals, predeclared
non-inferiority comparisons, pass^k, a logistic mixed model for difficulty,
held-out calibration, cosmetic perturbations, assumed loss simulation and
audit-only drift detection. Self-validation must pass before any function runs.

There is no LLM judge, no composite score and no router. Severity and future-book
predictions depend on printed assumptions; insufficient data is reported, not
papered over.

The import name `signal_sdk` avoids shadowing Python's standard-library `signal`.
The proposed package name is `signal-risk-sdk`. **Nothing has been published to PyPI.**
