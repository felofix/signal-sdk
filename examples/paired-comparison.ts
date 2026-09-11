/**
 * Two measurements with a bound predeclared currency-margin comparison.
 * Run with: npm run build && node dist/examples/paired-comparison.js
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { compareMeasurements } from "../src/certificate.js";
import { generateBook, paymentsEnvironment } from "../src/environments/payments/index.js";
import { demoDefinition, demoMandate, reconcile } from "../src/examples.js";
import { ComparisonPlan, ConfirmatoryComparison, FunctionImplementation, MeasurementConfig, measure } from "../src/index.js";

const slightlyDifferentPolicy: typeof reconcile = (context) => `Completed: ${reconcile(context)}`;

const { distribution, scenarios } = generateBook(24, { seed: 31, vendors: 8 });
const environment = paymentsEnvironment(demoMandate(scenarios));
const before = demoDefinition("policy-before").with({ implementation: { callable: "reconcile", revision: "1" } });
const after = demoDefinition("policy-after").with({ implementation: { callable: "slightlyDifferentPolicy", revision: "2" } });
const plan = new ComparisonPlan({ declaredAt: new Date().toISOString(), comparisons: [
  new ConfirmatoryComparison({ name: "wrong-account-loss", referenceId: before.id, candidateId: after.id, metric: "loss:wrong_account", margin: 1000, maximumSeverity: 5000 }),
] });
const config = new MeasurementConfig({ mode: "simulation", repetitions: 2, seed: 19, prepostPlan: plan, bootstrapSamples: 300, lossSimulations: 300,
  severityAssumptions: { wrong_account: { amount: 500, currency: "USD" } } });
const pre = await measure([new FunctionImplementation(before, reconcile, "simulation")], distribution, scenarios, { environment, config });
const post = await measure([new FunctionImplementation(after, slightlyDifferentPolicy, "simulation")], distribution, scenarios, { environment, config });
const comparison = compareMeasurements(pre, post) as { pairedDifferences: { comparisons: { conclusion: string }[] }[] };
mkdirSync("outputs/paired", { recursive: true });
writeFileSync("outputs/paired/pre.json", JSON.stringify(pre, null, 2));
writeFileSync("outputs/paired/post.json", JSON.stringify(post, null, 2));
writeFileSync("outputs/paired/comparison.json", JSON.stringify(comparison, null, 2));
console.log(comparison.pairedDifferences[0].comparisons[0].conclusion);
