---
title: Installation
group: Get started
summary: Install from the repository and run the self-validation gate.
---

Signal needs Python 3.11 or newer. The import name is `signal_sdk` (it must not shadow the standard library's `signal`); the CLI is `signal-sdk`.

## Example

```sh
git clone https://github.com/felofix/signal-sdk
cd signal-sdk
python3 -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'          # add [dashboard] for the local API
signal-sdk validate              # eight PASS/FAIL simulation checks
```

```json
{
  "status": "PASS",
  "suite_version": "signal-self-validation-v1",
  "checks": [
    {"name": "cluster_interval_coverage", "status": "PASS", "simulated_coverage": 0.953},
    {"name": "worse_function_rejected", "status": "PASS", "false_noninferiority_conclusions": 0},
    {"name": "zero_events_not_zero_risk", "status": "PASS", "upper_bound": 0.1391},
    {"name": "difficulty_recovers_planted_order", "status": "PASS"},
    {"name": "future_prediction_wider", "status": "PASS"},
    {"name": "calibration_cluster_separation", "status": "PASS"},
    {"name": "loss_recovers_planted_mean", "status": "PASS"},
    {"name": "controls_separated", "status": "PASS"}
  ]
}
```

## Extras

| Extra | Adds |
|---|---|
| `dev` | pytest, ruff, build, httpx, fastapi |
| `dashboard` | fastapi, uvicorn for `signal-sdk dashboard` |

## Dependencies

pydantic 2, numpy 2, scipy, pandas, statsmodels, rich. On machines with a heavily threaded BLAS set `OPENBLAS_NUM_THREADS=1` for the small mixed models.

The package is not on PyPI yet; the proposed distribution name is `signal-risk-sdk`.
