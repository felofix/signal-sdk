/** Local HTTP API for immutable measurements and their execution traces. Node's http module, nothing else. */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { Measurement, ValidationError } from "../models.js";
import { htmlDocument } from "../visualization.js";
import { DashboardStore, ImmutableConflict } from "./store.js";

export interface DashboardApp {
  store: DashboardStore;
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
  listen(port?: number, host?: string): Promise<Server>;
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function send(response: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const payload = type === "application/json" ? JSON.stringify(body) : String(body);
  response.writeHead(status, { "content-type": `${type}; charset=utf-8`, "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(422, "Body must be JSON"); }
}

export function createApp(dataDir: string | null = null): DashboardApp {
  const store = new DashboardStore(dataDir);
  const find = (id: string): Measurement => {
    let measurement: Measurement | null;
    try { measurement = store.get(id); } catch (error) { throw new HttpError(409, (error as Error).message); }
    if (!measurement) throw new HttpError(404, "Measurement not found");
    return measurement;
  };

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const parts = url.pathname.split("/").filter(Boolean);
    if (method === "GET" && url.pathname === "/health") return send(response, 200, { status: "ok" });
    if (url.pathname === "/api/measurements" || url.pathname === "/api/runs") {
      if (method === "POST") {
        const body = await readJson(request);
        try {
          const measurement = Measurement.fromJSON(body);
          const claimed = (body as { id?: unknown }).id;
          if (claimed !== undefined && claimed !== null && claimed !== measurement.id) throw new ImmutableConflict("Submitted measurement ID does not match its content hash");
          store.put(measurement);
          return send(response, 201, { id: measurement.id });
        } catch (error) {
          if (error instanceof ImmutableConflict) throw new HttpError(409, error.message);
          if (error instanceof ValidationError) throw new HttpError(422, error.message);
          throw error;
        }
      }
      if (method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? 100);
        if (!(limit >= 1 && limit <= 1000)) throw new HttpError(422, "limit must be between 1 and 1000");
        return send(response, 200, store.list(limit, url.searchParams.get("functionId")).map((m) => {
          const costs = m.trials.map((t) => t.grades.process.cost);
          return { id: m.id, timestamp: m.timestamp, functionIds: m.functions.map((f) => f.id), scenarios: m.scenarios.length, trials: m.trials.length,
            recordedCost: costs.reduce<number>((a, c) => a + (c ?? 0), 0), missingCostTrials: costs.filter((c) => c === null).length,
            latencyMs: m.trials.reduce((a, t) => a + t.grades.process.latencyMs, 0) };
        }));
      }
    }
    if (parts[0] === "api" && (parts[1] === "measurements" || parts[1] === "runs") && parts[2]) {
      const measurement = find(parts[2]);
      if (parts.length === 3 && method === "GET") return send(response, 200, measurement);
      if (parts[3] === "trials" && method === "GET") {
        if (parts[4] !== undefined) {
          const index = Number(parts[4]);
          if (!(Number.isInteger(index) && index >= 0 && index < measurement.trials.length)) throw new HttpError(404, "Trial not found");
          return send(response, 200, measurement.trials[index]);
        }
        const scenarioId = url.searchParams.get("scenarioId"), functionId = url.searchParams.get("functionId");
        return send(response, 200, measurement.trials.filter((t) => (!scenarioId || t.scenarioId === scenarioId) && (!functionId || t.functionId === functionId)));
      }
      if (parts[3] === "certificate") {
        if (method === "POST") {
          const body = await readJson(request);
          try { store.putCertificate(parts[2], body); } catch (error) {
            if (error instanceof ImmutableConflict) throw new HttpError(409, error.message);
            if (error instanceof ValidationError) throw new HttpError(422, error.message);
            throw error;
          }
          return send(response, 201, { measurementId: parts[2] });
        }
        if (method === "GET") {
          const certificate = store.getCertificate(parts[2]);
          if (!certificate) throw new HttpError(404, "Certificate not found");
          return send(response, 200, certificate);
        }
      }
    }
    if (parts[0] === "measurements" && parts[1] && parts.length === 2 && method === "GET") return send(response, 200, htmlDocument(find(parts[1])), "text/html");
    if (url.pathname === "/docs" && method === "GET") {
      return send(response, 200, ["GET /health", "POST|GET /api/measurements", "GET /api/measurements/{id}", "GET /api/measurements/{id}/trials[/{index}]",
        "POST|GET /api/measurements/{id}/certificate", "GET /measurements/{id} (HTML)"].join("\n"), "text/plain");
    }
    throw new HttpError(404, "Not found");
  }

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try { await route(request, response); } catch (error) {
      if (error instanceof HttpError) return send(response, error.status, { detail: error.message });
      if (error instanceof ValidationError) return send(response, 422, { detail: error.message });
      send(response, 500, { detail: (error as Error).message });
    }
  };

  return {
    store, handle,
    listen: (port = 8080, host = "127.0.0.1") => new Promise((resolve) => { const server = createServer(handle); server.listen(port, host, () => resolve(server)); }),
  };
}
