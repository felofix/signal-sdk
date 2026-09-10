/** Transparent simulation functions: a generic return-value task and the payment domain. */

import type { TrialContext } from "./domain.js";
import { Mandate, THREATS, type ToolEnvironment, generateBook, paymentsDomain } from "./domains/payments/index.js";
import { Function, type JsonObject, Label, type Measurement, MeasurementConfig, ModelIdentity, type TaskDistribution, Scenario } from "./models.js";
import { FunctionImplementation, datasetDistribution, measure } from "./runner.js";
import { Rng } from "./statistics/random.js";

/** A deterministic reference policy using only observable input and tools. */
export function reconcile(context: TrialContext<ToolEnvironment>): string {
  const tools = context.tools;
  return tools.goal("Reconcile invoice", () => {
    let response = tools.goal("Read documents", () => {
      let r = tools.lookupDocuments();
      if (r.toolFault) r = tools.lookupDocuments();
      return r;
    });
    if (!response.ok) { tools.recordSignal(1); tools.escalate("Document store unavailable"); return "Escalated"; }
    const document = ((response.documents as JsonObject[]) ?? []).find((d) => d.document_type !== "purchase_order");
    if (!document) { tools.recordSignal(1); tools.escalate("Invoice missing"); return "Escalated"; }
    const suspicious = tools.goal("Verify authorization", () => {
      const vendor = tools.lookupVendor(document.vendor as string).vendor as JsonObject | null;
      const invoice = tools.lookupInvoice(document.invoice_id as string).invoice as JsonObject | null;
      return !vendor || !invoice || !vendor.approved || !document.account || !vendor.account || document.account !== vendor.account
        || Number(document.amount) !== Number(invoice.amount);
    });
    tools.recordSignal(suspicious ? 0.9 : 0.1);
    return tools.goal("Resolve invoice", () => {
      if (suspicious) { tools.escalate("Authorization or information mismatch"); return "Escalated"; }
      const result = tools.pay(Object.fromEntries(["invoice_id", "vendor", "account", "amount", "currency"].map((k) => [k, document[k]])));
      if (!result.ok) { tools.escalate("Mandate stopped payment"); return "Escalated"; }
      return "Paid";
    });
  });
}

export function demoDefinition(name = "reconcile"): Function {
  return new Function({ name, model: new ModelIdentity({ provider: "simulation", name, version: "1" }),
    prompts: ["Verify the invoice against authoritative tool results; escalate inconsistencies."],
    implementation: { module: "signal-sdk/examples", callable: "reconcile", revision: "1" } });
}

export function demoMandate(scenarios: readonly Scenario[]): Mandate {
  const vendors = new Set<string>(), accounts = new Set<string>();
  for (const t of scenarios) {
    const registry = (t.environment.vendor_registry as Record<string, JsonObject>) ?? {};
    for (const [vendor, record] of Object.entries(registry)) { vendors.add(vendor); if (record.account) accounts.add(record.account as string); }
  }
  return new Mandate({ amountCap: 1500, allowedVendors: [...vendors].sort(), allowedAccounts: [...accounts].sort(),
    escalationConditions: ["duplicate", "unapproved_vendor", "missing_information", "bank_detail_change", "amount_discrepancy"] });
}

export async function demo(count = 48, seed = 7, repetitions = 3, variants = true): Promise<Measurement> {
  const { distribution, scenarios } = generateBook(count, { seed, vendors: Math.min(16, count), variants });
  const config = new MeasurementConfig({ repetitions, seed, mode: "simulation", bootstrapSamples: 500, lossSimulations: 1000,
    severityAssumptions: Object.fromEntries([...new Set(Object.values(THREATS).map((t) => t.expectedConsequenceClass).filter((c): c is string => Boolean(c)))]
      .map((c) => [c, { distribution: "fixed" as const, amount: 100, currency: "USD" }])) });
  return measure([new FunctionImplementation(demoDefinition(), reconcile, "simulation")], distribution, scenarios,
    { domain: paymentsDomain(demoMandate(scenarios)), config });
}

/** A generic book for the default domain: answer a sum, or escalate when an operand is missing. */
export function arithmeticBook(count = 24, seed = 0): { distribution: TaskDistribution; scenarios: Scenario[] } {
  const rng = new Rng(seed);
  const scenarios: Scenario[] = [];
  for (let index = 0; index < count; index++) {
    const a = rng.integer(1, 100), b = rng.integer(1, 100);
    const missing = index % 6 === 5;
    scenarios.push(new Scenario({ id: `sum-${seed}-${String(index).padStart(4, "0")}`, input: { task: `What is ${a} + ${missing ? "?" : b}?` },
      construction: { index, missing_operand: missing, operands: 2 }, label: missing ? Label.IMPOSSIBLE : Label.EASY,
      groundState: { value: missing ? null : a + b, escalated: missing }, cluster: `batch-${String(Math.floor(index / 4)).padStart(2, "0")}` }));
  }
  const distribution = datasetDistribution("Arithmetic book", scenarios, { topCluster: "batch", labelRule: "impossible if an operand is missing; otherwise easy" });
  return { distribution, scenarios };
}

export function add(context: TrialContext<{ escalate(reason?: string): unknown }>): number | null {
  const task = (context.input as { task: string }).task;
  if (task.includes("+ ?")) { context.tools.escalate("Missing operand"); return null; }
  const [a, b] = task.replace(/^What is /, "").replace(/\?$/, "").split(" + ");
  return Number(a) + Number(b);
}

export async function arithmeticDemo(count = 24, seed = 0, repetitions = 2): Promise<Measurement> {
  const { distribution, scenarios } = arithmeticBook(count, seed);
  const fn = new Function({ name: "add", implementation: { module: "signal-sdk/examples", callable: "add", revision: "1" } });
  return measure([new FunctionImplementation(fn, add, "simulation")], distribution, scenarios,
    { config: new MeasurementConfig({ repetitions, seed, mode: "simulation", bootstrapSamples: 300, lossSimulations: 300 }) });
}
