---
title: Concepts
group: Guides
summary: The vocabulary the SDK is built from, arranged as a bow-tie.
---

Signal follows the bow-tie from process safety: threats on the left, a top event in the knot, consequences on the right, preventive barriers before the knot and mitigating barriers after it. Signal measures the knot first. Everything left of it is diagnosis; everything right of it is a mapping applied later.

| Bow-tie position | Signal term | Read from |
|---|---|---|
| Threat | **Threat** class on each scenario | Generator / book construction |
| Causal chain | **Mechanism** | Transcript |
| Preventive barrier | Prompt, provenance, trust boundary | Function configuration |
| Top event | **Outcome** (final state ≠ ground state) | Outcome vs ground state |
| Mitigating barrier | Mandate (tool layer), human review | Tool layer |
| Consequence | **Loss** (separate section, only with a severity table) | Outcome × severity |

## Vocabulary

| Concept | Meaning |
|---|---|
| **Function** | The system under test and nothing else: `implementation`, pinned `model`/`models`, `prompts`, `configuration`. Its SHA-256 changes when any of them change. |
| **Domain** | Everything external the function can touch, bundled: an `EnvironmentDefinition`, a `GraderDefinition`, an environment factory, the grader, two trivial controls. |
| **Environment** | Tools, external state and enforcement for one trial. The function calls it; it records what actually happened. |
| **Mandate** | Hard limits enforced in the environment's tool layer. A limit that exists only in a prompt is a wish. |
| **Scenario** | One constructed test example: `input`, external `environment` state, `construction` parameters, a `label`, exactly one `threat`, injected `hazards`, a `groundState`, a `cluster`. The unit of all statistics. |
| **Threat** | The scenario's class from a closed enumeration declared on the distribution (`nominal`, `bank_detail_change`, `prompt_injection_email`, …). Each threat declares `goldActions`, `expectedMechanisms`, `expectedConsequenceClass` and `barrier` before any run. Prompt injection is a threat, not a special grader. |
| **Ground state** | What the world should look like after the trial: the actions that should have happened and the state the system should be in. Not a model output. |
| **Label** | A string the book's creator assigns by a written rule (`easy`, `complex`, `impossible` are a suggestion). Orthogonal to threat; both are reported. |
| **Trial** | One attempt at one scenario by one function, with a repetition index and a seed shared across functions. |
| **Transcript** | The recorded trajectory of the trial: tool calls with arguments and results, model usage, signals, messages, goals. |
| **Outcome** | The world after the trial: returned `value`, state-changing `actions`, `escalated`, final `state`. Never the function's claim. |
| **Outcome grade** | The top event. One grader for every threat: `correct`, `fieldF1`, the terminal `action` versus `goldAction`, a `deviation` from `wrong_action`, `wrong_value`, `missing_action`, `extra_action`, and `attemptedDeviation`. |
| **Mechanism** | Attribution from the transcript: `injection_followed`, `compaction_loss`, `hallucination`, `tool_fault_mishandled`, `mandate_attempt`, `misinterpretation` (the residual). Evaluated on every trial, reported on wrong outcomes; a fixed precedence names exactly one `primary`. |
| **Attempted / occurred** | Attempted = the function emitted a mutating action that deviates from gold, executed or not. Occurred = the final state deviates. Their difference is the mitigating barrier's effect, computed from actions and states, never from a loss table. |
| **Consequence detector** | A grader that feeds the loss layer (`canary_leak`). Neither an outcome nor a mechanism. |
| **Ruler** | How performance is measured over many trials: an estimate with an interval. |
| **Rating** | A categorical verdict on a trial by a named rater, attached after the fact. Judges enter here. |
| **Measurement** | The immutable crossing: functions × scenarios × repetitions, bound to distribution, environment, graders, optional validity period and self-validation evidence. |
| **Experiment** | A measurement read with a chosen set of rulers, with a baseline and paired differences. |
| **Risk certificate** | Per-function report: the outcome column and the mechanism column per threat, then process, difficulty, consistency, calibration, robustness, limitations. |
| **Audit sample** | Randomly selected, human-reviewed operational trials judged safe. The only input to drift. |

## Identity

`Function.id` hashes models, prompts, implementation and configuration. Environment, graders, distribution and validity are bound to the **measurement**; `Measurement.bindingId` ties them to the function IDs. Two measurements of the same function in different environments are two measurements, not two versions of one function.
