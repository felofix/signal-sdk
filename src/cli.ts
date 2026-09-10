#!/usr/bin/env node
/** Local command line interface. No provider calls are made by demo or validate. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `signal-sdk <command> [options]

  validate   [--seed 1729]
  demo       [--generic] [--scenarios 48] [--seed 7] [--repetitions 3] [--output outputs/demo] [--no-variants]
  report     <measurement.json> [--output outputs/report]
  compare    <pre.json> <post.json> [--output outputs/comparison.json]
  power      --margin <currency per 10,000> --paired-sd <currency> [--cluster-size 1] [--icc 0]
  dashboard  [--data outputs/store] [--host 127.0.0.1] [--port 8080]`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    seed: { type: "string" }, generic: { type: "boolean", default: false }, scenarios: { type: "string" }, repetitions: { type: "string" },
    output: { type: "string" }, "no-variants": { type: "boolean", default: false }, margin: { type: "string" }, "paired-sd": { type: "string" },
    "cluster-size": { type: "string" }, icc: { type: "string" }, data: { type: "string" }, host: { type: "string" }, port: { type: "string" }, help: { type: "boolean", default: false },
  } });
  const [command, ...rest] = positionals;
  if (!command || values.help) { console.log(USAGE); return command ? 0 : 1; }
  const num = (v: string | undefined, fallback: number) => (v === undefined ? fallback : Number(v));
  try {
    if (command === "validate") {
      const { selfValidate } = await import("./validation.js");
      const result = await selfValidate(num(values.seed, 1729));
      console.log(JSON.stringify(result, null, 2));
      return result.status === "PASS" ? 0 : 1;
    }
    if (command === "power") {
      const { sampleSize } = await import("./statistics/core.js");
      if (values.margin === undefined || values["paired-sd"] === undefined) throw new Error("power needs --margin and --paired-sd");
      console.log(JSON.stringify(sampleSize(Number(values.margin), Number(values["paired-sd"]), { icc: num(values.icc, 0), clusterSize: num(values["cluster-size"], 1) }), null, 2));
      return 0;
    }
    if (command === "dashboard") {
      const { createApp } = await import("./dashboard/app.js");
      const host = values.host ?? "127.0.0.1", port = num(values.port, 8080);
      await createApp(values.data ?? "outputs/store").listen(port, host);
      console.log(`Signal dashboard on http://${host}:${port}/docs`);
      return await new Promise<number>(() => undefined);
    }
    if (command === "compare") {
      const { compareMeasurements } = await import("./certificate.js");
      const { Measurement } = await import("./models.js");
      if (rest.length !== 2) throw new Error("compare needs <pre.json> <post.json>");
      const result = compareMeasurements(Measurement.fromJSON(JSON.parse(readFileSync(rest[0], "utf8"))), Measurement.fromJSON(JSON.parse(readFileSync(rest[1], "utf8"))));
      const output = values.output ?? "outputs/comparison.json";
      mkdirSync(resolve(output, ".."), { recursive: true });
      writeFileSync(output, JSON.stringify(result, null, 2));
      console.log(resolve(output));
      return 0;
    }
    if (command === "demo" || command === "report") {
      const { exportCertificates } = await import("./certificate.js");
      const { DashboardStore } = await import("./dashboard/store.js");
      const { Measurement } = await import("./models.js");
      const { exportHtml } = await import("./visualization.js");
      let measurement: InstanceType<typeof Measurement>;
      if (command === "demo") {
        const { arithmeticDemo, demo } = await import("./examples.js");
        measurement = values.generic ? await arithmeticDemo(num(values.scenarios, 48), num(values.seed, 7), num(values.repetitions, 3))
          : await demo(num(values.scenarios, 48), num(values.seed, 7), num(values.repetitions, 3), !values["no-variants"]);
      } else {
        if (!rest[0]) throw new Error("report needs <measurement.json>");
        measurement = Measurement.fromJSON(JSON.parse(readFileSync(rest[0], "utf8")));
      }
      const output = values.output ?? (command === "demo" ? "outputs/demo" : "outputs/report");
      mkdirSync(output, { recursive: true });
      const snapshot = join(output, "measurement.json");
      writeFileSync(snapshot, JSON.stringify(measurement, null, 2));
      new DashboardStore(join(output, "store")).put(measurement);
      const trace = exportHtml(measurement, join(output, "traces.html"));
      exportCertificates(measurement, join(output, "certificates"));
      console.log(`Measurement: ${resolve(snapshot)}\nTraces: ${resolve(trace)}\nCertificates: ${resolve(join(output, "certificates"))}`);
      return 0;
    }
    console.error(USAGE);
    return 1;
  } catch (error) {
    console.error(`signal-sdk: ${(error as Error).message}`);
    return 1;
  }
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, "/"));
if (invoked) main().then((code) => { if (code !== 0 || !process.argv.includes("dashboard")) process.exit(code); });
