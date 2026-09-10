import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/dashboard/app.js";
import { DashboardStore, ImmutableConflict } from "../src/dashboard/store.js";
import { Message } from "../src/models.js";
import { buildFlamegraphData, htmlDocument } from "../src/visualization.js";
import { fixtures } from "./fixtures.js";

test("html escapes transcripts and keeps goals and columns", async () => {
  const { measurement } = await fixtures();
  const trial = measurement.trials[0];
  const transcript = trial.transcript.with({ messages: [new Message({ role: "assistant", content: "<script>alert(1)</script>" })] });
  const changed = measurement.with({ trials: [trial.with({ transcript }), ...measurement.trials.slice(1)] });
  const html = htmlDocument(changed);
  assert.ok(!html.includes("<script>alert(1)</script>") && html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  for (const phrase of ["Reconcile invoice", "Verify authorization", "Outcome", "Events", "Process"]) assert.ok(html.includes(phrase), phrase);
  assert.equal(buildFlamegraphData(measurement).length, measurement.scenarios.length * measurement.functions.length);
});

test("store is write-once and detects tampering", async () => {
  const { measurement } = await fixtures();
  const dir = mkdtempSync(join(tmpdir(), "signal-store-"));
  const store = new DashboardStore(dir);
  assert.equal(store.put(measurement), measurement.id);
  assert.equal(store.put(measurement), measurement.id);
  assert.equal(store.get(measurement.id)!.id, measurement.id);
  store.putCertificate(measurement.id, { measurementId: measurement.id, value: 1 });
  assert.throws(() => store.putCertificate(measurement.id, { measurementId: measurement.id, value: 2 }), ImmutableConflict);
  const path = join(dir, `${measurement.id}.measurement.json`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.elapsedSeconds += 1;
  writeFileSync(path, JSON.stringify(data));
  assert.throws(() => store.get(measurement.id), ImmutableConflict);
  assert.throws(() => new DashboardStore().get("../../secret"), /Invalid/);
});

test("the http api stores, serves and refuses tampered snapshots", async () => {
  const { measurement } = await fixtures();
  const app = createApp(null);
  const server = await app.listen(0);
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const body = JSON.parse(JSON.stringify(measurement));
    assert.equal((await fetch(`${base}/api/measurements`, { method: "POST", body: JSON.stringify(body) })).status, 201);
    assert.equal((await fetch(`${base}/api/measurements/${measurement.id}/trials/0`)).status, 200);
    assert.equal((await fetch(`${base}/measurements/${measurement.id}`)).status, 200);
    body.elapsedSeconds += 1;
    assert.equal((await fetch(`${base}/api/measurements`, { method: "POST", body: JSON.stringify(body) })).status, 409);
    assert.equal((await fetch(`${base}/api/measurements/missing`)).status, 404);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally {
    server.close();
  }
});
