"""Configuration-derived risk certificates and paired pre/post reports."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .models import FrozenModel, Measurement, content_hash, thaw
from .runner import observation_rows
from .statistics import calibrate, compare, difficulty, loss_distribution, robustness, summarize


class RiskCertificate(FrozenModel):
    measurement_id: str
    function_id: str
    status: str
    columns: dict[str, Any]
    sections: tuple[dict[str, Any], ...]

    @property
    def id(self) -> str:
        return content_hash(self)


def limitations(measurement: Measurement, function_id: str) -> list[str]:
    function = next(f for f in measurement.functions if f.id == function_id)
    missing = sum(t.grades.process.cost is None for t in measurement.trials if t.function_id == function_id)
    lines = [
        f"This snapshot applies only to function {function.id} on distribution {measurement.distribution.id} "
        f"during {function.validity.start.isoformat()} to {function.validity.end.isoformat()}.",
        "A model update at the provider invalidates this certificate, even if the public model name stays the same. Re-measure with a pinned provider version.",
        "Changing prompts, tool descriptions, the toolset, its mandate, the document distribution, or the validity period requires a new measurement.",
        f"Severity is assumed. Configured severity distributions: {json.dumps(thaw(measurement.config.severity_assumptions), sort_keys=True)}.",
        f"The attack suite {measurement.distribution.attack_suite_version} gives a lower bound on attack exposure; untested attacks are outside this measurement.",
        "The unit is the episode. Repetitions are dependent; top-level clusters are assumed exchangeable and independent. Shared effects across declared clusters invalidate these intervals.",
        "Confidence intervals use a top-cluster bootstrap with a cluster-t envelope and conservative bounded-sample guards. Coverage is approximate, especially with few clusters.",
        "Difficulty and loss predictions depend on printed model and severity assumptions. A 95% posterior interval is not a frequentist coverage guarantee.",
        "Frequency measures attempted events; monetary loss uses occurred events. One action may trigger multiple harm classes; class losses are not summed into an insured total.",
        "Only the listed deterministic graders define measured harms. Omitted harms and a function's textual claims provide no evidence of safe final state.",
        "Calibration measures association with attempts; review curves assume loss prevention by review. They do not implement a router or establish a causal effect of human review.",
        "Drift is measured only on randomly selected, human-reviewed operational episodes judged safe; this constructed measurement alone does not measure drift.",
        "Function adapters are trusted instrumentation. The Python environment is not a security sandbox, and content hashes provide integrity checks, not a digital signature or external timestamp attestation.",
        f"Simulation self-validation status: {measurement.validation.get('status', 'missing')}. Passing finite seeded checks does not establish validity in every statistical regime.",
    ]
    if measurement.config.mode == "simulation":
        lines.append("This is a simulation measurement. It makes no claim about a real provider-backed function.")
    if missing:
        lines.append(f"Actual monetary usage was not recorded for {missing} trials; totals cover recorded usage only.")
    if not measurement.config.severity_assumptions:
        lines.append("No severity assumptions were supplied, so a monetary loss distribution is not estimable.")
    return lines


def certificates(measurement: Measurement) -> tuple[RiskCertificate, ...]:
    """Compute each analysis once and emit one ordered certificate per function."""
    rows = observation_rows(measurement)
    config = measurement.config
    summary = summarize(rows, bootstrap_samples=config.bootstrap_samples, seed=config.seed)
    hard = difficulty(rows, seed=config.seed)
    robust = robustness(observation_rows(measurement, include_variants=True),
                        bootstrap_samples=config.bootstrap_samples, seed=config.seed)
    labels = Counter(e.label.value for e in measurement.episodes if not e.variant_of)
    comparisons = _within_comparisons(measurement, rows)
    reports = []
    for function in measurement.functions:
        fid = function.id
        stats = summary["functions"][fid]
        selected = [t for t in measurement.trials if t.function_id == fid]
        loss = loss_distribution(rows, function_id=fid, severity_assumptions=thaw(config.severity_assumptions),
                                 simulations=config.loss_simulations, seed=config.seed)
        calibration = calibrate(rows, function_id=fid,
                                target_residual_loss=config.calibration_target_residual_loss,
                                bootstrap_samples=config.bootstrap_samples, seed=config.seed)
        costs = [t.grades.process.cost for t in selected]
        injection = {key: value for key, value in stats["events"].items() if key.startswith("injection_followed/")}
        prediction = hard.get("predictions", {}).get(fid)
        model_version_errors = [t.error for t in selected if t.error and "provider version" in t.error.lower()]
        status = "simulation" if config.mode == "simulation" else "measured"
        if function.model.provider == "signal" and function.name in {"always_pay", "always_escalate"}:
            status = "control"
        if model_version_errors:
            status = "invalid_provider_version"
        elif any(t.error for t in selected):
            status = "execution_errors_present"
        reports.append(RiskCertificate(measurement_id=measurement.id, function_id=fid,
            status=status, columns={key: stats[key] for key in ("outcome", "events", "process")},
            sections=(
                {"title": "Function identity", "data": function.model_dump(mode="json")},
                {"title": "Document distribution", "data": measurement.distribution.model_dump(mode="json")},
                {"title": "Validity and re-measurement", "data": {"period": thaw(function.validity),
                    "measurement_timestamp": measurement.timestamp.isoformat(),
                    "triggers": ["provider model update", "prompt change", "tool description change", "toolset or mandate change", "distribution change", "period expiry"]}},
                {"title": "Harm classes", "data": stats["events"]},
                {"title": "Loss per 10,000 episodes", "data": loss},
                {"title": "Book difficulty", "data": {"label_counts": dict(labels),
                    "outcome": stats["outcome"], "mixed_model": {k: v for k, v in hard.items() if k not in {"empirical_difficulty", "predictions"}},
                    "empirical_difficulty": hard.get("empirical_difficulty", {}).get(fid), "prediction": prediction}},
                {"title": "Consistency and process", "data": {"consistency": stats["consistency"], "process": stats["process"]}},
                {"title": "Calibration", "data": calibration},
                {"title": "Robustness", "data": robust["functions"][fid]},
                {"title": "Injection by vector", "data": {"rates": injection,
                    "scope": f"Measured against the specific suite {measurement.distribution.attack_suite_version}, not all attacks."}},
                {"title": "What this measurement does not say", "data": limitations(measurement, fid)},
                {"title": "Hours and cost spent", "data": {
                    "measurement_wall_hours": measurement.elapsed_seconds / 3600,
                    "function_step_hours": sum(t.grades.process.latency_ms for t in selected) / 3600000,
                    "recorded_cost": sum(c for c in costs if c is not None), "currency": config.currency,
                    "trials_with_missing_cost": sum(c is None for c in costs),
                    "self_validation_seconds": measurement.validation.get("elapsed_seconds"),
                    "trial_errors": [t.error for t in selected if t.error]}},
                {"title": "Predeclared comparisons", "data": comparisons},
            )))
    return tuple(reports)


def _within_comparisons(measurement: Measurement, rows: list[dict]) -> list[dict]:
    families: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for item in measurement.config.confirmatory_comparisons:
        families[(item.reference_id, item.candidate_id)].append(item.model_dump())
    family_size = sum(c.confirmatory for c in measurement.config.confirmatory_comparisons)
    if measurement.config.prepost_plan:
        family_size += sum(c.confirmatory for c in measurement.config.prepost_plan.comparisons)
    return [compare(rows, a, b, comparisons=items, family_size=family_size,
                    bootstrap_samples=measurement.config.bootstrap_samples, seed=measurement.config.seed)
            for (a, b), items in families.items()]


def compare_measurements(pre: Measurement, post: Measurement) -> dict:
    """Compare the same episodes as pairs, using a plan bound before execution."""
    if pre.distribution.id != post.distribution.id or content_hash(pre.episodes) != content_hash(post.episodes):
        raise ValueError("Pre/post comparisons require identical episode contents and distribution")
    if pre.timestamp > post.timestamp:
        raise ValueError("Pre measurement must precede post measurement")
    if pre.config.repetitions != post.config.repetitions:
        raise ValueError("Pre/post comparisons require the same repetitions")
    plan = pre.config.prepost_plan
    if plan is None or post.config.prepost_plan is None or plan.id != post.config.prepost_plan.id:
        raise ValueError("Both measurements must bind the same predeclared comparison plan")
    if plan.declared_at > pre.timestamp:
        raise ValueError("The comparison plan must predate both measurements")
    pre_rows, post_rows = observation_rows(pre), observation_rows(post)
    reports = []
    for comparison in plan.comparisons:
        left = [dict(r, function_id="pre") for r in pre_rows if r["function_id"] == comparison.reference_id]
        right = [dict(r, function_id="post") for r in post_rows if r["function_id"] == comparison.candidate_id]
        result = compare(left + right, "pre", "post", comparisons=[comparison.model_dump()],
                         family_size=sum(c.confirmatory for c in plan.comparisons)
                         + sum(c.confirmatory for c in pre.config.confirmatory_comparisons)
                         + sum(c.confirmatory for c in post.config.confirmatory_comparisons),
                         bootstrap_samples=post.config.bootstrap_samples, seed=post.config.seed)
        result.update(reference_function_id=comparison.reference_id, candidate_function_id=comparison.candidate_id,
                      comparison_kind="different_functions" if comparison.reference_id != comparison.candidate_id else "same_function_two_measurements")
        reports.append(result)
    return {"pre_measurement_id": pre.id, "post_measurement_id": post.id, "plan": plan.model_dump(mode="json"),
            "paired_differences": reports, "pre_certificates": [r.model_dump(mode="json") for r in certificates(pre)],
            "post_certificates": [r.model_dump(mode="json") for r in certificates(post)],
            "interpretation": "Different function IDs compare two functions, not two versions of one function."}


def _rate(value: dict) -> str:
    mean = value.get("estimate")
    low, high = value.get("interval", [None, None])
    if mean is None:
        return "not estimable"
    if low is None or high is None:
        return f"{mean:.4g}; interval not estimable"
    return f"{mean:.4g} [{low:.4g}, {high:.4g}]"


def markdown(certificate: RiskCertificate) -> str:
    lines = ["# Signal risk certificate", "", f"Status: **{certificate.status}**", "",
             f"Measurement: `{certificate.measurement_id}`", "", f"Function: `{certificate.function_id}`", "",
             "Outcome, events and process are separate measurements. Intervals are 95% unless multiplicity adjustment is stated.", ""]
    for section in certificate.sections:
        lines.extend([f"## {section['title']}", ""])
        data = thaw(section["data"])
        if section["title"] == "Harm classes":
            lines.extend(["| Harm | Attempted trials | Occurred trials | Attempt rate [interval] | Occurrence rate [interval] |",
                          "|---|---:|---:|---|---|"])
            for name, event in data.items():
                lines.append(f"| {name} | {event['attempted_trials']} | {event['occurred_trials']} | {_rate(event['attempts'])} | {_rate(event['occurrences'])} |")
            lines.append("")
            for name, event in data.items():
                note = event["attempts"].get("zero_event_note")
                if note:
                    lines.extend([f"{name}: {note}", ""])
        elif section["title"] == "Function identity":
            lines.extend([f"Name: **{data['name']}**", "",
                          f"Model: `{data['model']['provider']}/{data['model']['name']}`; pinned version `{data['model']['version']}`.", "",
                          "| Component | SHA-256 |", "|---|---|"])
            lines.extend(f"| {k} | `{v}` |" for k, v in data["component_hashes"].items())
            lines.extend(["", f"Period binding: `{data['binding_id']}`", ""])
        elif section["title"] == "Loss per 10,000 episodes":
            lines.extend(["| Harm | Mean | 95th percentile | 99th percentile | Expected-loss interval |",
                          "|---|---:|---:|---:|---|"])
            for harm, result in data["harms"].items():
                if result["status"] != "simulated":
                    lines.append(f"| {harm} | Not estimable: severity assumption required | | | |")
                else:
                    low, high = result["expected_loss_interval"]
                    lines.append(f"| {harm} | {result['mean']:.2f} | {result['p95']:.2f} | {result['p99']:.2f} | [{low:.2f}, {high:.2f}] |")
            lines.extend(["", "These are assumption-dependent posterior predictions. Severity assumptions:", ""])
            for harm, result in data["harms"].items():
                if "severity_assumption" in result:
                    lines.append(f"- {harm}: `{json.dumps(result['severity_assumption'], sort_keys=True)}`")
            lines.extend(["", *[f"- {v}" for v in data["assumptions"]], ""])
        elif section["title"] == "Book difficulty":
            lines.extend([f"Labels: {json.dumps(data['label_counts'], sort_keys=True)}.", "",
                          f"Correct final state: {_rate(data['outcome']['correct'])}.", "",
                          f"Field-level F1: {_rate(data['outcome']['field_f1'])}.", "",
                          f"Escalation when impossible: {_rate(data['outcome']['impossible_escalated'])}.", ""])
            model = data["mixed_model"]
            lines.extend([f"Mixed model: {model.get('status')}. {model.get('method', model.get('reason', ''))}", ""])
            if "label_explained_latent_fraction" in model:
                lines.extend([f"Label-explained latent variance fraction: {model['label_explained_latent_fraction']:.4g}.", ""])
            empirical = data.get("empirical_difficulty")
            if empirical and empirical.get("status") == "estimated":
                values = list(empirical["episodes"].values())
                lines.extend([f"Leave-function-out estimated failure probabilities across episodes: {min(values):.3f} to {max(values):.3f}. Full per-episode estimates are in the JSON certificate.", ""])
            if data.get("prediction"):
                prediction = data["prediction"]
                lines.extend([f"Measured-book expected correctness: {_rate(prediction['observed_book_expected_correct_rate'])}.", "",
                              f"Next 10,000 episode correctness: {_rate(prediction['next_book_correct_rate'])} (posterior prediction).", "",
                              f"Prediction-width check: {'PASS' if prediction['prediction_wider_than_measured_interval'] else 'FAIL' }.", ""])
        elif section["title"] == "Consistency and process":
            consistency = data["consistency"]
            lines.extend([f"Repetitions: {consistency['repetitions']}.", "",
                          f"pass^k (all repetitions correct): {_rate(consistency['pass_power_k'])}.", "",
                          f"Identical tool-call path: {_rate(consistency['path_consistency'])}.", "",
                          "| Process measurement | Estimate [interval] |", "|---|---|"])
            lines.extend(f"| {k} | {_rate(v)} |" for k, v in data["process"].items() if k != "cost_distribution")
            lines.extend(["", "Cost distribution (actual reported usage):", "", "```json",
                          json.dumps(data["process"]["cost_distribution"], indent=2), "```", ""])
        elif section["title"] == "Calibration":
            lines.extend([f"Status: {data['status']}.", ""])
            if data["status"] != "estimated":
                lines.extend([data["reason"], ""])
            else:
                lines.extend([f"Chosen threshold: {data['chosen_threshold']:.6g}; fitted on {data['split']['training_episodes']} episodes and reported on {data['split']['test_episodes']} episodes from disjoint clusters.", "",
                              "| Signal bin | Mean signal | Attempt rate [interval] |", "|---|---:|---|"])
                lines.extend(f"| {p['bin']} | {p['mean_signal']:.3f} | {_rate(p['attempt_rate'])} |" for p in data["calibration_curve"])
                lines.extend(["", "| Threshold | Review fraction [interval] | Residual loss / 10,000 [interval] |", "|---:|---|---|"])
                lines.extend(f"| {p['threshold']:.3g} | {_rate(p['review_fraction'])} | {_rate(p['residual_loss_per_10000'])} |" for p in data["review_curve"])
                lines.extend(["", *[f"- {v}" for v in data["assumptions"]], ""])
        elif section["title"] == "Robustness":
            for key in ("cosmetic_outcome_change_fraction", "tool_fault_mishandled_fraction"):
                lines.extend([f"{key}: {_rate(data[key]) if data[key] else 'not measured'}.", ""])
        elif section["title"] == "Injection by vector":
            lines.extend([data["scope"], "", "| Vector | Attempt rate [interval] | Occurrence rate [interval] |", "|---|---|---|"])
            lines.extend(f"| {name} | {_rate(v['attempts'])} | {_rate(v['occurrences'])} |" for name, v in data["rates"].items())
            lines.append("")
        elif isinstance(data, list) and all(isinstance(v, str) for v in data):
            lines.extend(f"- {item}" for item in data)
            lines.append("")
        else:
            lines.extend(["```json", json.dumps(data, indent=2, ensure_ascii=True), "```", ""])
    return "\n".join(lines)


def export_certificates(measurement: Measurement, directory: str | Path) -> tuple[Path, ...]:
    destination = Path(directory)
    destination.mkdir(parents=True, exist_ok=True)
    paths = []
    for report in certificates(measurement):
        stem = destination / report.function_id
        json_path, md_path = stem.with_suffix(".json"), stem.with_suffix(".md")
        json_path.write_text(report.model_dump_json(indent=2), encoding="utf-8")
        md_path.write_text(markdown(report), encoding="utf-8")
        paths.extend((json_path, md_path))
    return tuple(paths)
