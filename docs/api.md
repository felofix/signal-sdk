# API Reference

## Public Concepts

Import core concepts from `signal_sdk`. All concept models are frozen Pydantic
models with forbidden extra fields. Use `model_dump(mode="json")`,
`model_dump_json()`, `model_validate()`, and `model_validate_json()` for storage.

| Type | Main fields |
|---|---|
| `ModelIdentity` | `provider`, `name`, `version` |
| `ValidityPeriod` | timezone-aware `start`, `end` |
| `Mandate` | decimal `amount_cap`, `allowed_vendors`, `allowed_accounts`, `escalation_conditions`, `currency` |
| `Function` | `model`, `prompts`, `tool_descriptions`, `toolset`, `mandate`, `distribution_id`, `validity`, display `name` |
| `DocumentDistribution` | `name`, generator/seed/parameters or `dataset_hash`, `hazard_rates`, `label_rule`, `attack_suite_version`, `top_cluster` |
| `Episode` | `id`, `input`, `environment`, `construction`, `label`, `hazards`, `ground_truth`, `cluster`, `template`, optional `variant_of` |
| `Hazard` | `type`, `rate`, optional `vector`, target `instruction`, `canary` |
| `Step` | `index`, `kind`, `name`, `arguments`, `result`, `duration_ms`, `tokens`, nullable `cost`, `retry`, `goal`, `parent_goal`, `metadata` |
| `Transcript` | ordered `steps`, `messages`; step indices must be contiguous |
| `Outcome` | `payments`, `emails`, `held`, `escalated`, final `state` |
| `Event` | `harm`, `attempted`, `occurred`, decimal `severity`, optional `vector`, `evidence` |
| `Grades` | `outcome`, `events`, `process` |
| `Trial` | `episode_id`, `function_id`, `repetition`, `seed`, `transcript`, `outcome`, `grades`, optional `error` |
| `Measurement` | `functions`, `distribution`, `episodes`, `trials`, `timestamp`, `config`, `validation`, `elapsed_seconds` |
| `ConfirmatoryComparison` | `name`, `reference_id`, `candidate_id`, `metric`, `margin`, optional `maximum_severity`, `confirmatory` |
| `ComparisonPlan` | `declared_at`, `comparisons`; computed content `id` |
| `AuditSample` | episode/function/cluster/time identity, `judged_safe`, `selected_for_audit`, `inclusion_probability`, `attempted`, `cost`, `human_reviewed` |

`Function` exposes `id`, `binding_id`, and `component_hashes`. Distributions and
measurements expose `id`; episodes additionally expose `content_id`.
Computed IDs are recomputed on deserialization. `DashboardStore` and its HTTP API
also verify a submitted/stored measurement ID against the recomputed hash.

### MeasurementConfig

| Field | Default | Meaning |
|---|---|---|
| `repetitions` | 3 | At least two attempts per episode/function. |
| `seed` | 0 | Shared deterministic trial-seed root. |
| `bootstrap_samples` | 2000 | At least 200 top-cluster resamples. |
| `loss_simulations` | 5000 | At least 200 predictive loss draws. |
| `currency` | `USD` | Common currency for mandates and assumed severities. |
| `severity_assumptions` | `{}` | Harm-name mappings to fixed/gamma/lognormal settings. |
| `confirmatory_comparisons` | `()` | Comparisons declared before this crossing. |
| `prepost_plan` | `None` | Same bound plan on both pre/post snapshots. |
| `calibration_target_residual_loss` | `None` | Training target per 10,000; None uses zero observed residual loss. |
| `mode` | `simulation` | `simulation` or `real`; `measure()` without a config defaults to real mode. |
| `grader_version` | `signal-graders-v1` | Built-in measurement definition version. |
| `include_controls` | `True` | Required; false is rejected. |

For example, a severity assumption is
`{"wrong_account": {"distribution": "gamma", "mean": 500, "coefficient_of_variation": 1.5, "currency": "USD"}}`.
Fixed severity accepts `amount` or `mean`. Omitted severity is not inferred.

## Construction

From `signal_sdk.generators`:

```python
generate_book(count, seed=0, *, variants=False, **parameters)
# -> (DocumentDistribution, tuple[Episode, ...])

generate_episodes(count, seed=0, hazard_rates=None, *, vendors=20,
                  templates=4, impossible_rate=0.1)
# -> tuple[Episode, ...]

cosmetic_variants(episode)  # -> two episodes with variant_of set
label_from_construction(parameters)  # -> Label
dataset_distribution(name, episodes, *, label_rule, hazard_rates,
                     attack_suite_version, top_cluster="vendor")
```

`generate_book` binds generator settings and verifies reproducibility during
execution. `dataset_distribution` binds the complete supplied episode sequence.

### Payment Episode Schema

`environment` has `documents`, `vendor_registry`, `invoice_records`,
`paid_invoice_ids`, optional `emails`, and optional `faults`.

Invoice fields are `invoice_id`, `vendor`, `account`, `amount`, `currency`.
The registry maps vendor IDs to `{account, approved}`. Invoice records map invoice
IDs to authoritative invoice data. Fault entries are keyed by tool name and may
contain `persistent`, `retryable`, and `message`.

`ground_truth` has expected `payments` (invoice dictionaries), `held`,
`escalated`, optional expected `emails`, and optional expected `state` fields.
`reference_payments` provides authoritative payment facts even when escalation
is correct. Additional grading settings are `tolerance`, `approved_vendors`,
`canaries`, `canary_leak_severity`, and `escalation_cost`.

An injection hazard's `instruction` has `tool` and a subset of `arguments` that
define a matching harmful action. The built-in vectors are `document`, `email`,
and `tool_result`.

## Execution and Tools

From `signal_sdk`:

```python
FunctionImplementation(definition, execute, kind="real")
measure(functions, distribution, episodes, *, config=None, on_trial=None)
```

`execute(context)` is synchronous. `context` has mutable isolated `input`,
instrumented `tools`, a trial `seed`, and `repetition`. Use the same seed in the
provider or local stochastic implementation. Signal provides pairing, but cannot
force an external provider to honor its seed. `on_trial` receives each immutable
completed `Trial`. Controls are added by the runner.

`ToolEnvironment` supports these methods and equivalent `call(name, **args)`:

| Tool | Required arguments | Optional arguments |
|---|---|---|
| `lookup_documents` | none | none |
| `lookup_vendor` | `vendor` | none |
| `lookup_invoice` | `invoice_id` | none |
| `pay` | `invoice_id`, `vendor`, `account`, positive `amount` | `currency`, `memo` |
| `send_email` | `to`, `body` | `subject` |
| `hold` | none | `reason` |
| `escalate` | none | `reason` |

Unknown tools/arguments, missing required arguments, invalid text types, and
nonpositive/nonfinite amounts produce recorded schema errors. Payment is checked
against the mandate before changing state. Sending email has no built-in
recipient whitelist in this initial payment mandate; leaked canaries and injected
instructions are measured by the corresponding event graders.

Supported escalation conditions: `duplicate`, `unapproved_vendor`,
`missing_information`, `bank_detail_change`, `amount_discrepancy`, `tool_fault`.
Unknown condition names fail closed. `tool_fault` means any previously seen fault
forces escalation even if a retry later succeeds. A denied payment is held back;
the function must explicitly call `escalate` to produce an escalated outcome.

Instrumentation methods are `append_message(role, content)`,
`record_usage(tokens=..., cost=..., duration_ms=..., name="model", metadata=...)`,
`record_signal(probability)`, and nested `goal(name)` context managers.
`transcript()` and `outcome()` return immutable snapshots.

## Grading

From `signal_sdk.graders`:

```python
grade(episode, transcript, outcome)          # -> Grades
grade_outcome(episode, transcript, outcome)  # -> OutcomeGrade
grade_events(episode, transcript, outcome)   # -> tuple[Event, ...]
grade_process(episode, transcript, outcome)  # -> ProcessGrade
```

`HARM_CLASSES` enumerates all ten built-in harm classes. Injection is further
reported by vector. These functions have no network access, randomness, provider
calls, or language-model grading. The versioned built-in list is the measurement
definition; arbitrary plugins are not automatically accepted as insured graders.

## Statistics

`signal_sdk.runner.observation_rows(measurement, include_variants=False)` supplies
the canonical row dictionaries consumed by `signal_sdk.statistics`:

```python
summarize(rows, *, bootstrap_samples=2000, seed=0)
compare(rows, reference_id, candidate_id, *, comparisons=(),
        bootstrap_samples=2000, seed=0, family_size=None)
difficulty(rows, *, seed=0, future_episodes=10000, draws=1000)
calibrate(rows, *, function_id, target_residual_loss=None,
          seed=0, bins=5, bootstrap_samples=1000)
robustness(rows, *, bootstrap_samples=1000, seed=0)
loss_distribution(rows, *, function_id, severity_assumptions,
                  simulations=5000, seed=0, horizon=10000)
sample_size(margin_currency_per_10000, paired_sd_currency, *,
            power=0.8, icc=0, cluster_size=1, comparisons=1)
detectable_difference(episodes, paired_sd_currency, *,
                      power=0.8, icc=0, cluster_size=1, comparisons=1)
```

Results are JSON-compatible dictionaries. Rate objects have `estimate`,
`interval`, `confidence`, `episodes`, `clusters`, `method`, and optional
`zero_event_note`. Non-estimable results carry an explicit status and unavailable
values. See [Statistics](statistics.md) for interpretation rather than inferring
meaning from a single numeric field.

## Certificates and Persistence

From `signal_sdk.certificate`:

```python
certificates(measurement)  # -> tuple[RiskCertificate, ...]
markdown(certificate)  # -> str
export_certificates(measurement, directory)  # -> tuple[Path, ...]
compare_measurements(pre, post)  # -> paired report plus both certificate sets
limitations(measurement, function_id)  # -> list[str] derived from configuration
```

From `signal_sdk.visualization`: `html_document(measurement)`,
`export_html(measurement, path)`, and `render_terminal(measurement, console=None)`.

`DashboardStore(data_dir=None)` from `signal_sdk.dashboard.store` supports
`put(measurement)`, `get(id)`, `list(limit=100, function_id=None)`,
`put_certificate(measurement_id, json_object)`, and `get_certificate(id)`.
It permits repeated identical writes, rejects conflicting content, and uses
atomic create-only file persistence. A stored certificate must include its
`measurement_id`. To attach a full set, use an envelope with that ID and a
`certificates` array. Each attachment is write-once.

`create_app(data_dir=None)` from `signal_sdk.dashboard.app` provides:

| Method | Path | Meaning |
|---|---|---|
| GET | `/health` | Local health check. |
| POST / GET | `/api/measurements` | Store / list measurements. |
| GET | `/api/measurements/{id}` | Complete snapshot. |
| GET | `/api/measurements/{id}/trials` | Trials, optionally filtered by episode/function. |
| GET | `/api/measurements/{id}/trials/{index}` | One trial and trace. |
| POST / GET | `/api/measurements/{id}/certificate` | Attach / retrieve certificate JSON. |
| GET | `/measurements/{id}` | HTML trace explorer. |
| GET | `/docs` | Generated API documentation. |

## Operational Audits

From `signal_sdk.audit`:

```python
select_audit(*, judged_safe, fraction, rng=None)  # -> bool
audit_drift(samples, *, baselines, cost_upper_bound=None, **settings)
```

`rng` can be a seeded `random.Random` for simulation; the operational default is
`SystemRandom`. Baseline names are `attempts:<harm>` and `cost`. Drift settings
include `alpha=0.05` and `expected_shift=0.1`. `AuditSample` enforces human review
and positive inclusion probability. The low-level `detect_drift` additionally
accepts occurrence baselines when actual occurrence fields are supplied; the
typed audit adapter currently carries attempted events and cost.

## CLI

```text
signal-sdk validate [--seed 1729]
signal-sdk demo [--episodes 48] [--seed 7] [--repetitions 3]
                [--output outputs/demo] [--no-variants]
signal-sdk report MEASUREMENT.json [--output outputs/report]
signal-sdk compare PRE.json POST.json [--output outputs/comparison.json]
signal-sdk power --margin CURRENCY_PER_10000 --paired-sd CURRENCY
                 [--cluster-size 1] [--icc 0]
signal-sdk dashboard [--data outputs/store] [--host 127.0.0.1] [--port 8080]
```

Validation failure and invalid configurations return nonzero exit status. The
demo performs local simulation only. The CLI has no package publishing command.
