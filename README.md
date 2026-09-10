# Signal SDK

Measure a versioned function on a constructed document distribution, with tool-enforced
mandates, deterministic harm graders, and paired statistics clustered by episode book.

Signal reports three separate columns: **outcome**, **events**, and **process**.
It records attempted actions independently of their effects, keeps immutable
measurement snapshots, and generates risk certificates with explicit assumptions.

## Run It

Python 3.11 or newer:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
signal-sdk validate
signal-sdk demo --episodes 48 --output outputs/demo
```

The demo runs a deterministic reconciliation function and the always-pay and
always-escalate controls. It makes no provider calls. Open
`outputs/demo/traces.html` for goals, sub-goals, tool arguments/results, cost,
tokens, latency, and repeated-trial paths. Read the Markdown and JSON certificates
in `outputs/demo/certificates/`.

```python
from signal_sdk.examples import demo
from signal_sdk.certificate import certificates

measurement = demo(count=48, seed=7)
for report in certificates(measurement):
    print(report.function_id, report.status)
```

## Read the Guide

1. [SDK walkthrough](docs/README.md): concepts, installation, construction, execution, reports.
2. [Statistics](docs/statistics.md): estimands, intervals, pairing, difficulty, loss, calibration, drift.
3. [API reference](docs/api.md): public types, functions, tool schemas, CLI and dashboard endpoints.
4. [Specification map](docs/specification.md): what is implemented and its limits.
5. [Release guide](docs/releasing.md): package checks and the separate PyPI publication step.

## Scope

The built-in constructed domain is invoice reconciliation and payment. External
frameworks integrate through an ordinary callable and instrumented tools; none is
a dependency. The measurement core includes cluster bootstrap intervals,
predeclared non-inferiority comparisons, pass^k, a logistic mixed model,
held-out calibration, cosmetic perturbations, assumed loss simulation, and
audit-only drift detection.

Self-validation must pass before function execution. Its simulations are a test
suite, not proof of coverage in every regime. Difficulty uses approximate Bayesian
inference; severity and future-book predictions depend on printed assumptions.
Insufficient data is reported explicitly. There is no LLM judge, composite score,
or operational router.

This is a clean implementation. The import name `signal_sdk` avoids shadowing
Python's standard-library `signal`. The proposed package name is `signal-risk-sdk`.
**No package has been published to PyPI.**

Repository: [felofix/signal-sdk](https://github.com/felofix/signal-sdk).
