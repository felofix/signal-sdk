---
title: Concepts
group: Guides
summary: The vocabulary the SDK is built from.
---

Use these words consistently; the code does.

| Concept | Meaning |
|---|---|
| **Function** | The system under test and nothing else: `implementation` (revision or content hash), pinned `model`/`models`, `prompts`, `configuration`. Its SHA-256 changes when any of them change. |
| **Domain** | Everything external the function can touch, bundled: an `EnvironmentDefinition`, a `GraderDefinition`, an environment factory, the grader, two trivial controls. |
| **Environment** | Tools, external state and enforcement for one trial. The function calls it; it records what actually happened. |
| **Mandate** | Hard limits enforced in the environment's tool layer. A limit that exists only in a prompt is a wish. |
| **Scenario** | One constructed test example: `input`, external `environment` state, `construction` parameters, a `label`, injected `hazards`, a `groundState`, a `cluster`. The unit of all statistics. |
| **Ground state** | What the world should look like after the trial: the actions that should have happened and the state the system should be in. Not a model output. |
| **Label** | A string the book's creator assigns by a written rule. `easy`, `complex`, `impossible` are a suggestion, not a constraint. |
| **Book / task distribution** | The description of the scenarios: generator parameters with a seed, or a dataset hash; hazard rates; the label rule; an optional attack-suite version; the top cluster. |
| **Hazard** | An injected danger with a known type and rate, optionally a vector and a target instruction. |
| **Trial** | One attempt at one scenario by one function, with a repetition index and a seed shared across functions. |
| **Transcript** | The recorded trajectory of the trial: tool calls with arguments and results, model usage, signals, messages, goals. |
| **Outcome** | The world after the trial: returned `value`, state-changing `actions`, `escalated`, final `state`. Never the function's claim. |
| **Grader** | A pure, deterministic function of (scenario, transcript, outcome) → `Grades`. Defined by the domain. |
| **Event** | A harm grader's verdict: `attempted`, `occurred`, currency `severity`, evidence step indices. |
| **Ruler** | How performance is measured over many trials: an estimate with an interval. Accuracy, pass^k, cost, harm rate, inter-rater reliability. |
| **Rating** | A categorical verdict on a trial by a named rater, attached after the fact. Judges enter here. |
| **Measurement** | The immutable crossing: functions × scenarios × repetitions, bound to distribution, environment, graders, optional validity period and self-validation evidence. |
| **Experiment** | A measurement read with a chosen set of rulers, with a baseline and paired differences. |
| **Risk certificate** | Per-function report with the three columns and ordered sections, including generated limitations. |
| **Audit sample** | Randomly selected, human-reviewed operational trials judged safe. The only input to drift. |

## Identity

`Function.id` hashes models, prompts, implementation and configuration. Environment, graders, distribution and validity are bound to the **measurement**; `Measurement.bindingId` ties them to the function IDs. Two measurements of the same function in different environments are two measurements, not two versions of one function.

## Attempted versus occurred

Frequency is a property of the function: how often it *tries* a harmful action. Loss is a property of the deployment: how often the action *goes through*. The mandate sits between them, so both are recorded separately.
