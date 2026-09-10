import { Mandate, generateBook, paymentsDomain } from "../src/domains/payments/index.js";
import { demoDefinition, demoMandate, reconcile } from "../src/examples.js";
import { type Measurement, MeasurementConfig } from "../src/models.js";
import { FunctionImplementation, measure } from "../src/runner.js";

let cached: Promise<Measurement> | null = null;

export function cleanScenario() {
  return generateBook(1, { seed: 3, hazardRates: {}, impossibleRate: 0 }).scenarios[0];
}

export function broadMandate() {
  return new Mandate({ amountCap: 100000, allowedVendors: ["vendor-000"], allowedAccounts: ["account-000", "wrong", "unverified-000"] });
}

export async function fixtures() {
  cached ??= (async () => {
    const { distribution, scenarios } = generateBook(16, { seed: 8, vendors: 8, variants: true });
    return measure([new FunctionImplementation(demoDefinition(), reconcile, "simulation")], distribution, scenarios,
      { domain: paymentsDomain(demoMandate(scenarios)), config: new MeasurementConfig({ repetitions: 2, bootstrapSamples: 200, lossSimulations: 200 }) });
  })();
  return { measurement: await cached, scenario: cleanScenario(), mandate: broadMandate() };
}
