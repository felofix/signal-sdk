/** Append-only JSON storage for measurements and their certificates. */

import { existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { type JsonObject, Measurement, ValidationError, canonicalJson } from "../models.js";

/** A stored measurement or certificate cannot be replaced. */
export class ImmutableConflict extends ValidationError {
  constructor(message: string) { super(message); this.name = "ImmutableConflict"; }
}

function safeId(identifier: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(identifier)) throw new ValidationError("Invalid measurement identifier");
  return identifier;
}

/** Create-only storage. Repeating an identical write is idempotent. */
export class DashboardStore {
  readonly dataDir: string | null;
  private readonly memory = new Map<string, string>();

  constructor(dataDir: string | null = null) {
    this.dataDir = dataDir;
    if (dataDir) mkdirSync(dataDir, { recursive: true });
  }

  private path(kind: string, identifier: string): string { return join(this.dataDir!, `${safeId(identifier)}.${kind}.json`); }

  private read(kind: string, identifier: string): string | null {
    safeId(identifier);
    if (!this.dataDir) return this.memory.get(`${kind}:${identifier}`) ?? null;
    const path = this.path(kind, identifier);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  private write(kind: string, identifier: string, value: unknown): void {
    safeId(identifier);
    const content = canonicalJson(value, true);
    const previous = this.read(kind, identifier);
    if (previous !== null) {
      if (previous !== content) throw new ImmutableConflict(`${kind[0].toUpperCase()}${kind.slice(1)} ${identifier} already exists with different content`);
      return;
    }
    if (!this.dataDir) { this.memory.set(`${kind}:${identifier}`, content); return; }
    const destination = this.path(kind, identifier);
    const temporary = join(this.dataDir, `.${identifier}.${kind}.${process.pid}.${Date.now()}.tmp`);
    const fd = openSync(temporary, "w");
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      // Hard-link creation atomically refuses an existing destination, including a simultaneous writer.
      linkSync(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (readFileSync(destination, "utf8") !== content) throw new ImmutableConflict(`${kind[0].toUpperCase()}${kind.slice(1)} ${identifier} already exists with different content`);
    } finally {
      try { unlinkSync(temporary); } catch { /* already gone */ }
    }
  }

  /** Persist a content-addressed snapshot without modifying existing data. */
  put(measurement: Measurement): string {
    this.write("measurement", measurement.id, measurement);
    return measurement.id;
  }

  get(measurementId: string): Measurement | null {
    const content = this.read("measurement", measurementId);
    if (content === null) return null;
    const measurement = Measurement.fromJSON(JSON.parse(content));
    if (measurement.id !== measurementId) throw new ImmutableConflict("Stored measurement does not match its content hash");
    return measurement;
  }

  list(limit = 100, functionId: string | null = null): Measurement[] {
    if (!(limit >= 1 && limit <= 1000)) throw new ValidationError("limit must be between 1 and 1000");
    const ids = this.dataDir
      ? readdirSync(this.dataDir).filter((n) => n.endsWith(".measurement.json")).map((n) => n.slice(0, -".measurement.json".length))
      : [...this.memory.keys()].filter((k) => k.startsWith("measurement:")).map((k) => k.slice("measurement:".length));
    const found = ids.map((id) => this.get(id)).filter((m): m is Measurement => m !== null && (functionId === null || m.functions.some((f) => f.id === functionId)));
    return found.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, limit);
  }

  /** Attach a write-once JSON certificate bound to an existing measurement. */
  putCertificate(measurementId: string, certificate: unknown): void {
    if (this.get(measurementId) === null) throw new ValidationError(`Unknown measurement ${measurementId}`);
    const payload = certificate && typeof (certificate as { toJSON?: unknown }).toJSON === "function" ? (certificate as { toJSON: () => JsonObject }).toJSON() : certificate;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ValidationError("Certificate must be a JSON object");
    if ((payload as JsonObject).measurementId !== measurementId) throw new ValidationError("Certificate measurementId must match the stored measurement");
    this.write("certificate", measurementId, payload);
  }

  getCertificate(measurementId: string): JsonObject | null {
    const content = this.read("certificate", measurementId);
    return content === null ? null : (JSON.parse(content) as JsonObject);
  }
}
