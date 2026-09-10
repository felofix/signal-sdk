---
title: Traces and dashboard
group: SDK reference
summary: export_html(), render_terminal(), DashboardStore and create_app().
---

```python
from signal_sdk.visualization import html_document, export_html, render_terminal, build_flamegraph_data
from signal_sdk.dashboard.store import DashboardStore
from signal_sdk.dashboard.app import create_app

html_document(measurement: Measurement) -> str
export_html(measurement: Measurement, path: str | Path) -> Path
render_terminal(measurement: Measurement, console=None) -> None
build_flamegraph_data(measurement: Measurement) -> tuple[FlameGraphData, ...]

DashboardStore(data_dir: str | Path | None = None)
    .put(measurement) -> str
    .get(measurement_id) -> Measurement | None
    .list(limit=100, function_id=None) -> list[Measurement]
    .put_certificate(measurement_id, payload: dict) -> None
    .get_certificate(measurement_id) -> dict | None

create_app(data_dir: str | Path | None = None) -> FastAPI
```

## Example

```python
from signal_sdk.visualization import export_html
from signal_sdk.dashboard.store import DashboardStore
from signal_sdk.dashboard.app import create_app
import uvicorn

export_html(measurement, "outputs/traces.html")
store = DashboardStore("outputs/store")
store.put(measurement)
uvicorn.run(create_app("outputs/store"), host="127.0.0.1", port=8080)
```

```sh
curl -s localhost:8080/api/measurements | jq '.[0] | {id, functions, trials}'
open http://127.0.0.1:8080/measurements/<measurement-id>
```

## Trace explorer

One section per trajectory × function with a step-position table (which tool names appear at each position across repetitions, presence, mean latency, mean tokens) and one expandable trial per repetition: outcome, process, events table, goal tree with arguments and results, messages. Everything from transcripts is HTML-escaped.

## Store

Files are `<id>.measurement.json` and `<id>.certificate.json`. Writes are create-only; an identical rewrite is accepted, a conflicting one raises `ImmutableConflict`. Reads recompute the content hash and raise on tampering. IDs are validated against path traversal.

## API

| Method | Path |
|---|---|
| GET | `/health` |
| POST, GET | `/api/measurements` |
| GET | `/api/measurements/{id}` |
| GET | `/api/measurements/{id}/trials?trajectory_id=&function_id=` |
| GET | `/api/measurements/{id}/trials/{index}` |
| POST, GET | `/api/measurements/{id}/certificate` |
| GET | `/measurements/{id}` (HTML) |
| GET | `/docs` |

Install the `dashboard` extra. There is no authentication; the API is local infrastructure.
