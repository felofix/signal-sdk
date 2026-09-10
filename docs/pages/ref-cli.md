---
title: CLI
group: SDK reference
summary: signal-sdk validate, demo, report, compare, power, dashboard.
---

```text
signal-sdk validate [--seed 1729]
signal-sdk demo [--generic] [--trajectories 48] [--seed 7] [--repetitions 3] [--output outputs/demo] [--no-variants]
signal-sdk report MEASUREMENT.json [--output outputs/report]
signal-sdk compare PRE.json POST.json [--output outputs/comparison.json]
signal-sdk power --margin CURRENCY_PER_10000 --paired-sd CURRENCY [--cluster-size 1] [--icc 0]
signal-sdk dashboard [--data outputs/store] [--host 127.0.0.1] [--port 8080]
```

## Example

```sh
signal-sdk validate | jq .status
signal-sdk demo --generic --trajectories 24 --output outputs/generic
signal-sdk demo --trajectories 48 --output outputs/payments
signal-sdk report outputs/payments/measurement.json --output outputs/report
signal-sdk power --margin 1000 --paired-sd 2 --cluster-size 10 --icc 0.2
```

```text
Measurement: /…/outputs/generic/measurement.json
Traces: /…/outputs/generic/traces.html
Certificates: /…/outputs/generic/certificates
```

## Commands

| Command | Does |
|---|---|
| `validate` | Runs the eight simulation checks and prints the evidence JSON. Exit 1 on FAIL. |
| `demo` | Runs the payments demo (default) or the generic arithmetic demo (`--generic`), writes the snapshot, traces and certificates, and stores the snapshot. |
| `report` | Regenerates traces and certificates from a saved snapshot. |
| `compare` | Pre/post paired report from two snapshots that share a bound plan. |
| `power` | Trajectories needed for a currency margin under the paired normal approximation. |
| `dashboard` | Serves the local API and trace explorer (needs the `dashboard` extra). |

No command calls a provider. Invalid inputs exit with status 1 and a one-line reason.
