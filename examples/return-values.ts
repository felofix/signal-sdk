/**
 * Measure any callable that returns a value: no tools, no documents, no payments.
 *
 * The function under test is identified by what it is (implementation, model,
 * prompts, configuration). The book, the environment and the graders are bound to
 * the measurement, not to the function.
 *
 * Run with: npm run build && node dist/examples/return-values.js
 */

import { Function, FunctionImplementation, MeasurementConfig, Scenario, datasetDistribution, measure } from "../src/index.js";
import { exportCertificates } from "../src/certificate.js";
import { exportHtml } from "../src/visualization.js";

const words = ["signal", "measure", "scenario", "trial", "grader", "outcome", "process", "event", "loss"];
const scenarios = words.map((word, i) => new Scenario({
  id: `upper-${String(i).padStart(3, "0")}`, input: { task: `Uppercase: ${word}` }, label: "easy",
  groundState: { value: word.toUpperCase() }, cluster: `group-${Math.floor(i / 3)}`,
}));
const distribution = datasetDistribution("Uppercase words", scenarios, { labelRule: "all easy", topCluster: "group" });

function upper(context: { input: { task: string }; trace: { goal<T>(name: string, block: () => T): T } }): string {
  return context.trace.goal("Uppercase the word", () => context.input.task.replace(/^Uppercase: /, "").toUpperCase());
}

const fn = new Function({ name: "upper", implementation: { module: "examples/return-values", callable: "upper", revision: "1" } });
const measurement = await measure([new FunctionImplementation(fn, upper as never, "simulation")], distribution, scenarios,
  { config: new MeasurementConfig({ mode: "simulation", repetitions: 2, bootstrapSamples: 300, lossSimulations: 300 }) });
exportCertificates(measurement, "outputs/return-values/certificates");
exportHtml(measurement, "outputs/return-values/traces.html");
console.log(measurement.id, measurement.trials.length, "trials");
