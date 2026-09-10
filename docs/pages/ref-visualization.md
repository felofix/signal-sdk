---
title: Traces and dashboard
group: SDK reference
summary: exportHtml(), renderTerminal(), DashboardStore and createApp().
---

```ts
import { buildFlamegraphData, exportHtml, htmlDocument, renderTerminal } from "signal-sdk/visualization";
import { DashboardStore, createApp } from "signal-sdk/dashboard";

htmlDocument(measurement: Measurement): string
exportHtml(measurement: Measurement, path: string): string
renderTerminal(measurement: Measurement, write?: (line: string) => void): void
buildFlamegraphData(measurement: Measurement): FlameGraphData[]

new DashboardStore(dataDir: string | null = null)
  .put(measurement): string
  .get(measurementId): Measurement | null
  .list(limit = 100, functionId: string | null = null): Measurement[]
  .putCertificate(measurementId, payload: object): void
  .getCertificate(measurementId): JsonObject | null

createApp(dataDir: string | null = null): { store, handle(req, res), listen(port = 8080, host = "127.0.0.1"): Promise<http.Server> }
```

## Example

```ts
import { exportHtml } from "signal-sdk/visualization";
import { DashboardStore, createApp } from "signal-sdk/dashboard";

exportHtml(measurement, "outputs/traces.html");
new DashboardStore("outputs/store").put(measurement);
const server = await createApp("outputs/store").listen(8080);
console.log("http://127.0.0.1:8080/docs");
```

```sh
curl -s localhost:8080/api/measurements | jq '.[0] | {id, functionIds, trials}'
open http://127.0.0.1:8080/measurements/<measurement-id>
```

## Trace explorer

One section per scenario × function with a step-position table (which tool names appear at each position across repetitions, presence, mean latency, mean tokens) and one expandable trial per repetition: outcome, process, events table, goal tree with arguments and results, messages. Everything from transcripts is HTML-escaped.

## Store

Files are `<id>.measurement.json` and `<id>.certificate.json`. Writes are create-only (an atomic hard-link publish); an identical rewrite is accepted, a conflicting one throws `ImmutableConflict`. Reads recompute the content hash and throw on tampering. IDs are validated against path traversal. Without a `dataDir` the store is in-memory.

## API

| Method | Path |
|---|---|
| GET | `/health` |
| POST, GET | `/api/measurements` |
| GET | `/api/measurements/{id}` |
| GET | `/api/measurements/{id}/trials?scenarioId=&functionId=` |
| GET | `/api/measurements/{id}/trials/{index}` |
| POST, GET | `/api/measurements/{id}/certificate` |
| GET | `/measurements/{id}` (HTML) |
| GET | `/docs` |

Node's `http` module only, no framework, no authentication; the API is local infrastructure.
