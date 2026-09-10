<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo.svg" alt="signal" width="96">
  </picture>
</p>

<h1 align="center">Signal SDK</h1>

<p align="center">A statistical measuring instrument for agent systems.<br>
Deterministic graders · rulers · paired, clustered statistics · risk certificates</p>

<p align="center"><img src="docs/assets/hero.jpg" alt="" width="100%"></p>

Signal runs a precisely identified **function** (the system under test) against a
book of **scenarios** (constructed test examples with a ground state) inside an
external **domain**, grades every trial deterministically, and reads **rulers**
off the results. The report has two columns per threat, arranged as a bow-tie:
**outcome** (does the final state match the ground state, and how does it deviate)
and **mechanism** (why, attributed from the transcript). Attempted deviations are
read from actions and occurred deviations from state; the gap is what the mandate
caught. Nothing is summed into one number.

TypeScript, Node 20+, zero runtime dependencies. The numerics (seeded RNG,
cluster bootstrap, t/normal quantiles, Cholesky, a Laplace-approximation logistic
mixed model) live in `src/statistics/` and are auditable in-repo.

**[Documentation](https://felofix.github.io/signal-sdk/)** · **[Worked example](https://felofix.github.io/signal-sdk/example.html)** · [llms.txt](docs/llms.txt)

## Run It

```sh
git clone https://github.com/felofix/signal-sdk && cd signal-sdk
npm install
npm test                                                     # build + node:test suite
node dist/src/cli.js validate                                # thirteen PASS/FAIL checks
node dist/src/cli.js demo --generic --output outputs/generic # default domain, arithmetic book
node dist/src/cli.js demo --output outputs/payments          # payments domain, ten threats
```

Both demos run without provider calls and add the domain's two trivial controls.
Open `traces.html` in the output folder for goals, tool calls, cost, tokens and
latency; read the Markdown and JSON certificates in `certificates/`.

Measuring your own callable takes a book, a `Function` identity and a call:

```ts
import { Function, FunctionImplementation, Scenario, datasetDistribution, runExperiment } from "signal-sdk";

const words = ["signal", "measure", "scenario", "trial", "grader", "loss"];
const book = words.map((w, i) => new Scenario({
  id: `s${i}`, input: { task: `Uppercase: ${w}` }, label: "easy",
  groundState: { value: w.toUpperCase() }, cluster: `g${Math.floor(i / 3)}`,
}));
const distribution = datasetDistribution("Uppercase words", book, { labelRule: "all easy", topCluster: "group" });

const upper = (context: { input: { task: string } }) => context.input.task.replace("Uppercase: ", "").toUpperCase();
const fn = new Function({ name: "upper", implementation: { module: "my-agent", revision: "abc123" } });

const experiment = await runExperiment("uppercase", [new FunctionImplementation(fn, upper, "simulation")], distribution, book, { repetitions: 2 });
console.log(experiment.table());
```

`runExperiment()` compares variants on one book with the rulers you choose;
`rateTrials()` attaches human or model judges whose reliability becomes a ruler
too. See [examples/](examples/).

## Read the Guide

The documentation site lives in [`docs/`](docs/) and is built from
[`docs/pages/`](docs/pages/) by `npm run docs`. It covers concepts, building a
book, writing a domain, rulers, comparisons and power, certificates, the
statistics, and a per-function SDK reference. [`docs/llms.txt`](docs/llms.txt)
is the whole thing as one Markdown file for coding agents. The
[specification map](docs/specification.md) and [release guide](docs/releasing.md)
remain as Markdown.

## Scope

Cluster bootstrap intervals, predeclared non-inferiority comparisons, pass^k, a
logistic mixed model for difficulty, held-out calibration, cosmetic perturbations,
assumed loss simulation and audit-only drift detection. Self-validation must pass
before any function runs.

There is no LLM judge inside the SDK, no composite score and no router. A judge
can be attached as a rater after the fact, and its reliability against the
deterministic grader is itself a ruler. Severity and future-book predictions
depend on printed assumptions; insufficient data is reported, not papered over.

**Not yet published to npm.** The package name is `signal-sdk`; see the release guide.
