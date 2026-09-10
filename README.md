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
constructed **book** of trajectories inside an external **environment**, grades every
trial with deterministic graders, and reports three separate columns: **outcome**,
**events**, **process**. They are never summed into one number.

Nothing about the task domain lives in the core. Documents, tools, mandates and
harm definitions are supplied by a `Domain`; the built-in default grades plain
return values, and an optional invoice-payment domain shows a tool-using,
adversarial setup with a tool-enforced mandate.

**[Documentation](https://felofix.github.io/signal-sdk/)** · **[Worked example with real numbers](https://felofix.github.io/signal-sdk/example.html)** · [llms.txt](docs/llms.txt)

Measuring is not only a gate. `run_experiment()` compares variants on one book with the rulers you choose, and `rate_trials()` attaches human or model judges whose reliability becomes a ruler too.

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
from signal_sdk import Trajectory, Function, FunctionImplementation, Label, MeasurementConfig, dataset_distribution, measure

trajectories = tuple(Trajectory(id=f"e{i}", input={"task": f"Uppercase: {w}"}, label=Label.EASY,
                         ground_truth={"value": w.upper()}, cluster=f"g{i // 3}")
                 for i, w in enumerate(["signal", "measure", "trajectory", "trial", "grader", "loss"]))
distribution = dataset_distribution("Uppercase words", trajectories, label_rule="all easy", top_cluster="group")

def upper(context):
    return context.input["task"].removeprefix("Uppercase: ").upper()

function = Function(name="upper", implementation={"module": "my_agent", "revision": "abc123"})
measurement = measure((FunctionImplementation(function, upper, kind="simulation"),), distribution, trajectories,
                      config=MeasurementConfig(mode="simulation", repetitions=2))
```

See [examples/return_values.py](examples/return_values.py) and
[examples/paired_comparison.py](examples/paired_comparison.py).

## Read the Guide

The documentation site lives in [`docs/`](docs/) and is built from [`docs/pages/`](docs/pages/) by `python docs/build_site.py`. It covers concepts, building a book, writing a domain, rulers, comparisons and power, certificates, the statistics, and a per-function SDK reference. [`docs/llms.txt`](docs/llms.txt) is the whole thing as one Markdown file for coding agents. The [specification map](docs/specification.md) and [release guide](docs/releasing.md) remain as Markdown.

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
