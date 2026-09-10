# Signal SDK Guide

Signal measures how a precisely identified agent system behaves on a constructed
book of tasks. A measurement is evidence about that function, in that
environment, on that distribution, during that period. It is not a permanent
property of a software system.

The SDK is domain-neutral. The core knows about episodes, trials, transcripts,
outcomes and grades; it does not know what a document, a payment or a tool is.
Those come from a `Domain`. Two are included: the default `RETURN_VALUES` domain,
which grades whatever the function returns, and `signal_sdk.domains.payments`,
an invoice-reconciliation environment with tools, a tool-enforced mandate,
injected hazards and ten harm graders.

## 1. Install and Validate

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
signal-sdk validate
```

Validation runs seeded simulations and prints PASS or FAIL per check: cluster
interval coverage, rejection of a deliberately worse function, positive
zero-event bounds, recovery of planted difficulty, wider future-book prediction,
cluster separation for calibration, planted expected loss, and separation of the
two trivial controls. `measure()` calls this gate automatically and refuses to
execute if any check fails. The evidence is bound into every measurement.

## 2. The Concept Model

| Concept | Meaning in the SDK |
|---|---|
| Function | The system under test and nothing else: `implementation` (revision or content hash), pinned `model`/`models`, `prompts`, `configuration`. |
| Environment | Everything external the function can touch: tool implementation and descriptions, enforcement (mandate), configuration. Bound to the measurement. |
| Mandate | Hard limits enforced in the environment's tool layer. A limit that exists only in a prompt is a wish, not a mandate. |
| Task distribution | The book: generator parameters with a seed, or a dataset hash; hazard rates, label rule, optional attack-suite version, top cluster. |
| Episode | One constructed task: `input`, external `environment` state, `construction`, fixed `label`, `hazards`, `ground_truth`, `cluster`. |
| Label | `easy`, `complex` or `impossible`, derived from construction before any function runs. |
| Hazard | An injected danger with a known type, rate, optional vector, target instruction and canary. |
| Trial | One episode × one function × one repetition, with a seed shared across functions. |
| Transcript | Ordered steps (tool calls, model usage, signals) with arguments, results, tokens, cost, latency, goals; plus messages. |
| Outcome | What actually happened: returned `value`, state-changing `actions`, `escalated`, final `state`. Never the function's claim. |
| Grader | A pure, deterministic function of (episode, transcript, outcome) → `Grades`. Defined by the domain. |
| Event | A harm grader result: `attempted`, `occurred`, currency `severity`, evidence step indices. |
| Measurement | The immutable crossing: functions, distribution, environment, graders, optional validity, controls, episodes, trials, config, validation evidence. |
| Audit sample | Randomly selected, human-reviewed operational episodes that were judged safe. The only input to drift. |
| Risk certificate | Per-function report with the three columns and ordered sections. |

### Identity

`Function.id` hashes four components: models, prompts, implementation,
configuration. Change one and it is a new function. `name` is a display label.
Provider versions such as `latest` are rejected.

The environment (`EnvironmentDefinition.id`), the graders (`GraderDefinition.id`),
the distribution and the validity period are bound to the **measurement**, and
`Measurement.binding_id` hashes them together with the function IDs. Two
measurements of the same function in different environments are two different
measurements, not two versions of one function.

All models are frozen, including nested mappings. `model_copy(update=...)` builds
a new validated object. Hashes are integrity identifiers, not signatures.

## 3. Construct the Book

### Any domain

Build `Episode` objects yourself and bind them by content hash:

```python
from signal_sdk import Episode, Label, dataset_distribution

episodes = tuple(
    Episode(id=f"sum-{i}", input={"task": f"What is {a} + {b}?"}, label=Label.EASY,
            ground_truth={"value": a + b}, cluster=f"batch-{i // 4}")
    for i, (a, b) in enumerate([(1, 2), (3, 4), (5, 6), (7, 8), (9, 10), (11, 12)])
)
distribution = dataset_distribution("Sums", episodes, label_rule="all easy", top_cluster="batch")
```

Write down the label rule and apply it deterministically during construction.
For an impossible episode set `ground_truth["escalated"] = True` (or label it
`impossible`); the default grader then requires escalation and nothing else.
`cluster` is the top-level unit that the statistics resample; episodes in one
cluster are assumed dependent, clusters independent.

### The payments domain

```python
from signal_sdk.domains.payments import generate_book, payments_domain, Mandate

distribution, episodes = generate_book(
    count=80, seed=42, vendors=20, templates=4, impossible_rate=0.10,
    hazard_rates={"bank_detail_change": 0.08, "duplicate": 0.06, "amount_discrepancy": 0.08,
                  "unapproved_vendor": 0.05, "tool_fault": 0.05, "prompt_injection_document": 0.05,
                  "prompt_injection_email": 0.05, "prompt_injection_tool_result": 0.05},
    variants=True,
)
domain = payments_domain(Mandate(amount_cap="1500", allowed_vendors=(...), allowed_accounts=(...),
                                 escalation_conditions=("duplicate", "bank_detail_change")))
```

Hazards are sampled independently at the configured probabilities. Vendors are
the top cluster; `variants=True` adds two cosmetic variants per episode for the
robustness check. The generator is reproducible, so the runner regenerates the
book and refuses edited episodes.

## 4. Identify the Function

```python
from signal_sdk import Function, ModelIdentity

function = Function(
    name="invoice-agent",
    model=ModelIdentity(provider="your-provider", name="your-model", version="immutable-version-id"),
    prompts=("Reconcile the invoice; escalate when authorization is missing.",),
    implementation={"repository": "org/agent", "revision": "9f3c1e2"},
    configuration={"temperature": 0, "max_steps": 12},
)
```

Use `models=(...)` for multi-model systems. Tool descriptions and mandates do
**not** belong here; they are part of the environment. The adapter is
responsible for the declared implementation actually being what runs.

## 5. Wrap Execution

Your synchronous callable receives a `TrialContext` with `input`, `tools` (the
domain's environment), `trace`, `seed` and `repetition`. Whatever the environment
records is the outcome; returned text is only evidence in the default domain,
where the return value *is* the outcome.

```python
from signal_sdk import FunctionImplementation, MeasurementConfig, measure

def run(context):
    with context.tools.goal("Answer"):
        context.tools.record_usage(tokens=usage.total, cost=usage.cost, duration_ms=latency,
                                   metadata={"provider_version": observed_version})
        return answer

measurement = measure((FunctionImplementation(function, run, kind="real"),), distribution, episodes,
                      config=MeasurementConfig(mode="real", repetitions=3))
```

Pass `domain=` to use another domain, and `validity=ValidityPeriod(...)` to bind
a period. Real functions must record actual model usage with a `provider_version`
matching the declared model; missing usage is recorded as unreported, never as
zero. `record_signal(p)` before the first state-changing action feeds
calibration. Exceptions keep everything recorded so far and mark the trial.

The runner always adds the domain's two trivial controls (`never_escalate` and
`always_escalate` by default; `always_pay` and `always_escalate` for payments).
A grader that cannot separate them is broken, and the self-validation gate
checks that.

## 6. Write a Domain

A `Domain` bundles what is external to the function:

```python
from signal_sdk import Domain, EnvironmentDefinition, GraderDefinition, Grades, OutcomeGrade, Outcome, process_grade, field_f1

class Env:
    def __init__(self, episode, seed, trace):
        self.trace, self.input = trace, dict(episode.input)
        self.goal, self.record_usage, self.record_signal = trace.goal, trace.record_usage, trace.record_signal
    def search(self, query):                       # a tool: recorded, never hidden
        return self.trace.record_tool("search", {"query": query}, lambda: {"ok": True, "hits": [...]})
    def finish(self, returned):
        return Outcome(value=returned)

def grade(episode, transcript, outcome):
    expected = episode.ground_truth["value"]
    return Grades(outcome=OutcomeGrade(correct=outcome.value == expected, field_f1=field_f1(expected, outcome.value)),
                  events=(), process=process_grade(transcript), metrics={"chars": float(len(str(outcome.value)))})

domain = Domain(
    environment=EnvironmentDefinition(name="search", implementation={"version": "1"}, tool_descriptions={"search": "..."}),
    graders=GraderDefinition(name="search", version="1", components={"outcome": "exact match"}),
    make_environment=Env, grade=grade,
    controls=(("empty", lambda ctx: ""), ("always_escalate", lambda ctx: ctx.tools.escalate())),
)
```

Graders must be pure: no network, no randomness, no language model. Custom
`metrics` appear as their own column and can be used in predeclared comparisons
as `metric:<name>` with an explicit `direction` and `unit`.

## 7. Read the Three Columns

**Outcome**: correct final state against ground truth, field-level F1 as support,
escalation when impossible. **Events**: per harm class, attempted vs. occurred and
severity; the mandate can stop an occurrence without erasing the attempt.
**Process**: schema validity, steps, retries, actual tokens and cost, latency,
tool-call path signature. **Metrics**: domain-defined numbers. They are never
summed into one score.

## 8. Predeclare Comparisons and Power

Choose margins before running. Within a measurement, put
`ConfirmatoryComparison` objects in `MeasurementConfig.confirmatory_comparisons`;
for pre/post work, bind one `ComparisonPlan` to both configurations. Metrics are
`correct`, process fields, `loss:<harm>` (currency per 10,000 episodes,
`maximum_severity` required for a bounded interval) or `metric:<name>`.
`compare_measurements(pre, post)` requires identical episodes, environment,
graders and plan, and states whether it compares two functions or two
measurements of one. `sample_size()` and `detectable_difference()` plan the book
before execution. See [Statistics](statistics.md).

## 9. Certificates, Traces, Dashboard

```python
from signal_sdk.certificate import export_certificates
from signal_sdk.visualization import export_html
from signal_sdk.dashboard.store import DashboardStore

DashboardStore("outputs/store").put(measurement)
export_certificates(measurement, "outputs/certificates")
export_html(measurement, "outputs/traces.html")
```

A certificate covers function identity, task distribution, environment and
graders, validity and re-measurement triggers, harm classes, custom metrics,
loss per 10,000, book difficulty, consistency and process, calibration,
robustness, injection by vector, what the measurement does not say, hours and
cost, and predeclared comparisons. `signal-sdk report` and `signal-sdk dashboard`
do the same from the command line; the dashboard is local and unauthenticated.

## 10. Calibration and Audited Drift

Calibration fits a review threshold on half of the clusters and reports on the
other half. Drift consumes only randomly selected, human-reviewed operational
episodes that were judged safe (`signal_sdk.audit`). Neither is a router.

## 11. What the Result Does Not Establish

Severity is assumed. The attack suite is a lower bound. The certificate covers
one function in one environment on one distribution in one period, and a
provider model update invalidates it. That last point is why measurement is a
service, not a project. The limitations section of every certificate is generated
from the actual configuration.
