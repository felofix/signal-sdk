# API Reference

## Public Concepts

Import from `signal_sdk`. All concept models are frozen Pydantic models with
forbidden extra fields; use `model_dump(mode="json")`, `model_dump_json()`,
`model_validate()` and `model_validate_json()` for storage.

| Type | Main fields |
|---|---|
| `ModelIdentity` | `provider`, `name`, pinned `version` |
| `Function` | `implementation` (required, non-empty), `model` or `models`, `prompts`, `configuration`, display `name`; computed `id`, `component_hashes` |
| `EnvironmentDefinition` | `name`, `implementation`, `tool_descriptions`, `configuration`, `mandate`; computed `id` |
| `GraderDefinition` | `name`, `version`, `components`; computed `id` |
| `TaskDistribution` | `name`, generator/seed/parameters or `dataset_hash`, `hazard_rates`, `label_rule`, optional `attack_suite_version`, `top_cluster`; computed `id` |
| `ValidityPeriod` | timezone-aware `start`, `end` |
| `Episode` | `id`, `input` (any JSON), `environment`, `construction`, `label`, `hazards`, `ground_truth`, `cluster`, `template`, optional `variant_of` |
| `Hazard` | `type`, `rate`, optional `vector`, `instruction`, `canary` |
| `Step` | `index`, `kind` (`tool`, `model`, `signal`), `name`, `arguments`, `result`, `duration_ms`, nullable `tokens`/`cost`, `retry`, `goal`, `parent_goal`, `metadata` |
| `Transcript` | ordered `steps`, `messages` |
| `Outcome` | `value`, `actions` (state-changing tool calls), `escalated`, final `state` |
| `Event` | `harm`, `attempted`, `occurred`, decimal `severity`, optional `vector`, `evidence` |
| `Grades` | `outcome`, `events`, `process`, `metrics` |
| `Trial` | `episode_id`, `function_id`, `repetition`, `seed`, `transcript`, `outcome`, `grades`, optional `error` |
| `Measurement` | `functions`, `distribution`, `environment`, `graders`, optional `validity`, `control_ids`, `episodes`, `trials`, `timestamp`, `config`, `validation`; computed `id`, `binding_id` |
| `ConfirmatoryComparison` | `name`, `reference_id`, `candidate_id`, `metric`, `margin`, optional `maximum_severity`, `direction`, `unit`, `value_bounds` |
| `ComparisonPlan` | `declared_at`, `comparisons`; computed `id` |
| `AuditSample` | operational audit evidence for drift |

### MeasurementConfig

| Field | Default | Meaning |
|---|---|---|
| `repetitions` | 3 | At least two attempts per episode/function. |
| `seed` | 0 | Root of the shared trial seeds. |
| `bootstrap_samples` | 2000 | Top-cluster resamples (min 200). |
| `loss_simulations` | 5000 | Predictive loss draws (min 200). |
| `currency` | `USD` | Currency of severity assumptions. |
| `severity_assumptions` | `{}` | Per-harm fixed/gamma/lognormal settings, e.g. `{"wrong_account": {"distribution": "gamma", "mean": 500, "coefficient_of_variation": 1.5, "currency": "USD"}}`. |
| `confirmatory_comparisons` | `()` | Comparisons declared for this crossing. |
| `prepost_plan` | `None` | The same bound plan on pre and post; exclusive with the above. |
| `calibration_target_residual_loss` | `None` | Training target per 10,000. |
| `mode` | `simulation` | `simulation` or `real`. `measure()` without a config uses real mode. |

## Domains

```python
from signal_sdk import Domain, RETURN_VALUES, TraceRecorder, TrialContext, process_grade, field_f1

Domain(environment: EnvironmentDefinition, graders: GraderDefinition,
       make_environment: Callable[[Episode, int, TraceRecorder], Environment],
       grade: Callable[[Episode, Transcript, Outcome], Grades],
       controls: tuple[tuple[str, Callable[[TrialContext], Any]], ...],   # at least two
       reproduce: Callable[[TaskDistribution], tuple[Episode, ...]] | None = None)
```

An environment instance exposes whatever the function may call plus
`finish(returned) -> Outcome`. `TraceRecorder` provides `goal(name)`,
`append_message`, `record_usage(tokens=, cost=, duration_ms=, metadata=)`,
`record_signal(p)`, `record_tool(name, arguments, call, state_changing=False)`
and `transcript()`. `process_grade(transcript)` and `field_f1(expected, actual)`
are reusable grader parts.

`RETURN_VALUES` is the default: the environment has only `escalate()`, the
outcome is the return value, correctness is equality with
`ground_truth["value"]` (or escalation when `ground_truth["escalated"]` or the
label is `impossible`), and the single harm is `unnecessary_escalation`.
Controls: `never_escalate`, `always_escalate`.

### Payments domain

`signal_sdk.domains.payments` exports `payments_domain(mandate)`, `Mandate`,
`broad_mandate(episodes)`, `generate_book`, `generate_episodes`,
`cosmetic_variants`, `reproduce_book`, `ToolEnvironment`, `HARM_CLASSES`,
`grade`, `grade_outcome`, `grade_events`.

`Mandate(amount_cap, allowed_vendors, allowed_accounts, escalation_conditions, currency)`
is enforced in `pay`. Empty whitelists deny every payment. Escalation conditions:
`duplicate`, `unapproved_vendor`, `missing_information`, `bank_detail_change`,
`amount_discrepancy`, `tool_fault`.

| Tool | Required arguments | Optional arguments |
|---|---|---|
| `lookup_documents` | none | none |
| `lookup_vendor` | `vendor` | none |
| `lookup_invoice` | `invoice_id` | none |
| `pay` | `invoice_id`, `vendor`, `account`, positive `amount` | `currency`, `memo` |
| `send_email` | `to`, `body` | `subject` |
| `hold` | none | `reason` |
| `escalate` | none | `reason` |

Episode `environment` holds `documents`, `vendor_registry`, `invoice_records`,
`paid_invoice_ids`, optional `emails` and `faults`. `ground_truth` holds
`payments`, `escalated`, `held`, optional `emails`/`state`, `reference_payments`,
`tolerance`, `approved_vendors`, `canaries`, `canary_leak_severity`,
`escalation_cost`. Harm classes: wrong account, duplicate, amount discrepancy,
unapproved vendor, mandate breach, hallucinated action, canary leak, injection
followed (per vector), unnecessary escalation, mishandled tool fault.

## Construction

```python
from signal_sdk import dataset_distribution
dataset_distribution(name, episodes, *, label_rule, hazard_rates=None,
                     attack_suite_version=None, top_cluster="episode")

from signal_sdk.domains.payments import generate_book
generate_book(count, seed=0, *, variants=False, vendors=20, templates=4,
              impossible_rate=0.1, hazard_rates=None)  # -> (TaskDistribution, episodes)
```

A generated distribution is verified at measurement time through the domain's
`reproduce`; a dataset distribution through its content hash.

## Execution

```python
from signal_sdk import FunctionImplementation, measure

FunctionImplementation(definition, execute, kind="real")   # kinds: real, simulation, control
measure(functions, distribution, episodes, *, domain=RETURN_VALUES, config=None,
        validity=None, on_trial=None) -> Measurement
```

`execute(context)` is synchronous and receives `TrialContext(input, tools, trace,
seed, repetition)`. Controls are added by the runner. Real functions must record
model usage whose `provider_version` matches a declared model.

## Statistics

`signal_sdk.runner.observation_rows(measurement, include_variants=False)` yields
the row dictionaries consumed by `signal_sdk.statistics`:

```python
summarize(rows, *, bootstrap_samples=2000, seed=0)          # outcome, events, process, consistency, metrics
compare(rows, reference_id, candidate_id, *, comparisons=(), bootstrap_samples=2000, seed=0, family_size=None)
difficulty(rows, *, seed=0, future_episodes=10000, draws=1000)
calibrate(rows, *, function_id, target_residual_loss=None, seed=0, bins=5, bootstrap_samples=1000)
robustness(rows, *, bootstrap_samples=1000, seed=0)
loss_distribution(rows, *, function_id, severity_assumptions, simulations=5000, seed=0, horizon=10000)
sample_size(margin_currency_per_10000, paired_sd_currency, *, power=0.8, icc=0, cluster_size=1, comparisons=1)
detectable_difference(episodes, paired_sd_currency, *, power=0.8, icc=0, cluster_size=1, comparisons=1)
```

Comparison metrics: `correct`, `field_f1`, `schema_valid`, `cost`, `latency_ms`,
`tokens`, `steps`, `retries`, `loss:<harm>`, `metric:<name>` (needs `direction`
and `unit`; optional `value_bounds`).

## Certificates and Persistence

```python
from signal_sdk.certificate import certificates, markdown, export_certificates, compare_measurements, limitations
from signal_sdk.visualization import html_document, export_html, render_terminal
from signal_sdk.dashboard.store import DashboardStore
from signal_sdk.dashboard.app import create_app
```

The store is write-once by content ID and re-verifies hashes on read. Dashboard
endpoints: `GET /health`, `POST|GET /api/measurements`, `GET /api/measurements/{id}`,
`GET /api/measurements/{id}/trials[/{index}]`, `POST|GET /api/measurements/{id}/certificate`,
`GET /measurements/{id}` (HTML), `GET /docs`.

## Operational Audits

```python
from signal_sdk.audit import select_audit, audit_drift
select_audit(*, judged_safe, fraction, rng=None) -> bool
audit_drift(samples, *, baselines, cost_upper_bound=None, alpha=0.05, expected_shift=0.1)
```

## CLI

```text
signal-sdk validate [--seed 1729]
signal-sdk demo [--generic] [--episodes 48] [--seed 7] [--repetitions 3] [--output outputs/demo] [--no-variants]
signal-sdk report MEASUREMENT.json [--output outputs/report]
signal-sdk compare PRE.json POST.json [--output outputs/comparison.json]
signal-sdk power --margin CURRENCY_PER_10000 --paired-sd CURRENCY [--cluster-size 1] [--icc 0]
signal-sdk dashboard [--data outputs/store] [--host 127.0.0.1] [--port 8080]
```
