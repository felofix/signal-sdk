"""Terminal and standalone HTML views of recorded measurement traces."""

from __future__ import annotations

import html
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from signal_sdk.models import Measurement, Trial


@dataclass(frozen=True)
class StepStats:
    """Descriptive trace data at a sequence position, within one crossed cell."""

    step_index: int
    total_trials: int
    present_count: int
    action_distribution: dict[str, int]
    avg_duration_ms: float
    avg_tokens: float | None


@dataclass(frozen=True)
class FlameGraphData:
    trajectory_id: str
    function_id: str
    trials: int
    correct: int
    steps: tuple[StepStats, ...]
    recorded_cost: Decimal
    missing_cost_trials: int
    avg_latency_ms: float


def build_flamegraph_data(measurement: Measurement) -> tuple[FlameGraphData, ...]:
    """Retain sequence distributions without attributing final failure to a step."""
    grouped: dict[tuple[str, str], list[Trial]] = defaultdict(list)
    for trial in measurement.trials:
        grouped[(trial.trajectory_id, trial.function_id)].append(trial)
    graphs = []
    for (trajectory_id, function_id), trials in sorted(grouped.items()):
        steps = []
        for position in range(max((len(t.transcript.steps) for t in trials), default=0)):
            present = [t.transcript.steps[position] for t in trials if len(t.transcript.steps) > position]
            steps.append(StepStats(
                step_index=position,
                total_trials=len(trials),
                present_count=len(present),
                action_distribution=dict(Counter(s.name for s in present)),
                avg_duration_ms=sum(s.duration_ms for s in present) / len(present),
                avg_tokens=None if any(s.tokens is None for s in present) else sum(s.tokens for s in present) / len(present),
            ))
        costs = [t.grades.process.cost for t in trials]
        graphs.append(FlameGraphData(
            trajectory_id=trajectory_id,
            function_id=function_id,
            trials=len(trials),
            correct=sum(t.grades.outcome.correct for t in trials),
            steps=tuple(steps),
            recorded_cost=sum((Decimal(str(c)) for c in costs if c is not None), Decimal(0)),
            missing_cost_trials=sum(c is None for c in costs),
            avg_latency_ms=sum(t.grades.process.latency_ms for t in trials) / len(trials),
        ))
    return tuple(graphs)


def _escape(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _json(value: Any) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return _escape(json.dumps(value, indent=2, ensure_ascii=True, default=str))


def _money(value: Any) -> str:
    return "unreported" if value is None else f"{Decimal(str(value)):.6f}"


def _tokens(value: Any) -> str:
    return "unreported" if value is None else f"{value:.1f}"


def _function_label(function: Any) -> str:
    models = ", ".join(f"{m.provider}/{m.name}@{m.version}" for m in function.model_identities)
    return f"{function.name} ({models})" if models else function.name


def _step_html(step: Any, offset_ms: float, total_ms: float) -> str:
    left = min(100.0, max(0.0, offset_ms / total_ms * 100))
    width = min(100.0 - left, max(0.4, step.duration_ms / total_ms * 100))
    retry = ' <span class="retry">retry</span>' if step.retry else ""
    return f"""<details class="step">
      <summary><span class="step-name"><span class="muted">{step.index}</span>
        <span class="kind">{_escape(step.kind)}</span> {_escape(step.name)}{retry}</span>
        <span class="step-meta">{step.duration_ms:.1f} ms &middot; {_tokens(step.tokens)} tokens
        &middot; {_money(step.cost)}</span></summary>
      <div class="timing" aria-label="Recorded step duration"><div class="timing-bar"
        style="margin-left:{left:.5f}%;width:{width:.5f}%"></div></div>
      <div class="step-body"><h4>Arguments</h4><pre>{_json(step.arguments)}</pre>
      <h4>Result</h4><pre>{_json(step.result)}</pre>
      <h4>Metadata</h4><pre>{_json(step.metadata)}</pre></div>
    </details>"""


def _trace_html(trial: Trial) -> str:
    total_ms = max(sum(step.duration_ms for step in trial.transcript.steps), 1.0)
    offsets = []
    elapsed = 0.0
    for step in trial.transcript.steps:
        offsets.append(elapsed)
        elapsed += step.duration_ms

    parents: dict[str, str | None] = {}
    goal_steps: dict[str | None, list[tuple[int, Any]]] = defaultdict(list)
    for position, step in enumerate(trial.transcript.steps):
        goal = step.goal or None
        if goal is not None:
            parents.setdefault(goal, step.parent_goal or None)
        goal_steps[goal].append((position, step))
    for parent in tuple(parents.values()):
        if parent is not None:
            parents.setdefault(parent, None)

    # Malformed or cyclic goal metadata must never hide recorded steps.
    children: dict[str | None, list[str]] = defaultdict(list)
    for goal, parent in parents.items():
        seen = {goal}
        cursor = parent
        while cursor is not None and cursor not in seen:
            seen.add(cursor)
            cursor = parents.get(cursor)
        children[None if cursor is not None else parent].append(goal)

    def render_goal(goal: str | None, depth: int = 0) -> str:
        content = []
        entries = [(position, "step", step) for position, step in goal_steps[goal]]
        for child in children[goal]:
            earliest = min((pos for pos, _ in goal_steps[child]), default=-1)
            entries.append((earliest, "goal", child))
        for position, kind, value in sorted(entries, key=lambda entry: entry[0]):
            if kind == "step":
                content.append(_step_html(value, offsets[position], total_ms))
            else:
                content.append(render_goal(value, depth + 1))
        body = "".join(content)
        if goal is None:
            return body
        return f'<details class="goal" open><summary>{_escape(goal)}</summary>{body}</details>'

    return render_goal(None) or '<p class="muted">No recorded steps.</p>'


def _trial_html(trial: Trial, ordinal: int) -> str:
    outcome = trial.grades.outcome
    process = trial.grades.process
    events = []
    for event in trial.grades.events:
        events.append(f"""<tr><td>{_escape(event.harm)}</td><td>{event.attempted}</td>
          <td>{event.occurred}</td><td>{_money(event.severity)}</td>
          <td>{_escape(event.vector or '')}</td><td>{_escape(event.evidence)}</td></tr>""")
    events_table = f"""<div class="table-scroll"><table><thead><tr><th>Harm</th>
      <th>Attempted</th><th>Occurred</th><th>Severity</th><th>Vector</th><th>Evidence</th>
      </tr></thead><tbody>{''.join(events)}</tbody></table></div>""" if events else '<p class="muted">No event grades.</p>'
    error = f'<p class="error">{_escape(trial.error)}</p>' if trial.error else ""
    return f"""<details class="trial" id="trial-{ordinal}">
      <summary><span>Repetition {trial.repetition} <span class="muted">seed {trial.seed}</span></span>
      <span class="{'correct' if outcome.correct else 'incorrect'}">{'Correct' if outcome.correct else 'Incorrect'}</span>
      <span>{process.latency_ms:.1f} ms &middot; {_money(process.cost)}</span></summary>
      {error}<div class="grade-columns">
      <section><h3>Outcome</h3><dl><dt>Correct final state</dt><dd>{outcome.correct}</dd>
      <dt>Field F1</dt><dd>{outcome.field_f1:.3f}</dd><dt>Required escalation met</dt>
      <dd>{_escape(outcome.required_escalation_met)}</dd></dl>
      <details><summary>Outcome after trial</summary><pre>{_json(trial.outcome)}</pre></details></section>
      <section><h3>Process</h3><dl><dt>Schema valid</dt><dd>{process.schema_valid}</dd>
      <dt>Steps / retries</dt><dd>{process.steps} / {process.retries}</dd>
      <dt>Tokens</dt><dd>{process.tokens}</dd><dt>Recorded cost</dt><dd>{_money(process.cost)}</dd>
      <dt>Latency</dt><dd>{process.latency_ms:.1f} ms</dd></dl>
      <details><summary>Tool-call path signature</summary><pre>{_escape(process.path_signature)}</pre></details></section>
      </div><section><h3>Events</h3>{events_table}</section>
      <section><h3>Trace</h3>{_trace_html(trial)}</section>
      <details class="messages"><summary>Messages</summary><pre>{_json(trial.transcript.messages)}</pre></details>
    </details>"""


_STYLE = """
:root {color-scheme:light; font-family:system-ui,-apple-system,sans-serif; color:#24272a;
background:#fff; font-size:14px; letter-spacing:0}
* {box-sizing:border-box} body {margin:0} header {padding:24px max(20px,calc((100% - 1180px)/2));
background:#f4f6f5; border-bottom:1px solid #d9e0dc} main {max-width:1220px;margin:0 auto;padding:24px 20px}
h1 {font-size:26px;margin:0 0 10px} h2 {font-size:19px;margin:0 0 10px} h3 {font-size:15px;margin:16px 0 8px}
h4 {font-size:13px;margin:12px 0 4px} p {line-height:1.5} a {color:#17604a}
.muted {color:#616968} code,.identity {overflow-wrap:anywhere} .identity {font-family:monospace;font-size:12px}
.toolbar {display:flex;gap:20px;flex-wrap:wrap;margin-bottom:24px} label {display:grid;gap:6px;min-width:0}
select {max-width:100%;padding:8px;background:#fff;border:1px solid #b9c6bf;border-radius:4px}
.cell {padding:20px 0 28px;border-top:1px solid #d9e0dc}.cell:first-of-type {border-top:0}
.cell-summary {display:flex;gap:20px;flex-wrap:wrap;font-size:13px;margin:12px 0 18px}
table {width:100%;min-width:560px;border-collapse:collapse;text-align:left;font-size:13px}
th,td {padding:9px 12px;border-bottom:1px solid #e2e7e4;vertical-align:top;overflow-wrap:anywhere}
th {font-weight:600;background:#f4f6f5} .table-scroll {max-width:100%;overflow-x:auto}
.presence {height:8px;background:#e2e7e4;min-width:70px;margin-top:5px}.presence span {display:block;height:100%;background:#378366}
.trial {border-top:1px solid #cbd6d0;margin-top:12px;padding-top:8px}
summary {cursor:pointer;overflow-wrap:anywhere} .trial>summary {display:flex;justify-content:space-between;gap:12px;padding:10px 0;flex-wrap:wrap}
.trial>summary::before {content:'+';color:#616968}.trial[open]>summary::before {content:'-'}
.correct {color:#17604a}.incorrect,.error {color:#a12b40}.grade-columns {display:grid;grid-template-columns:1fr 1fr;gap:24px}
section {min-width:0} dl {display:grid;grid-template-columns:1fr auto;gap:6px} dt {color:#616968} dd {margin:0}
pre {white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.5;background:#f4f6f5;padding:12px;max-height:380px;overflow:auto}
.goal {border-left:3px solid #7cafa0;margin:12px 0 12px 8px;padding-left:12px}.goal>summary {font-weight:600;padding:6px 0}
.step {margin:8px 0}.step>summary {display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px;background:#f4f6f5}
.step-name {overflow-wrap:anywhere;min-width:0}.kind {font-size:11px;color:#5d4674}.step-meta {font-size:12px;color:#616968}
.retry {color:#9d5818;font-size:11px}.timing {height:7px;background:#edf0ee;overflow:hidden}
.timing-bar {height:100%;background:#bb6c42}.step-body {padding:0 8px}.messages {margin:20px 0}
footer {border-top:1px solid #d9e0dc;padding:20px;color:#616968;font-size:12px}
[hidden] {display:none!important}@media(max-width:600px){.grade-columns{grid-template-columns:1fr;gap:0}
.toolbar label{width:100%}th,td{padding:8px}.goal{margin-left:3px;padding-left:6px}}
"""


def html_document(measurement: Measurement) -> str:
    """Build an offline trace explorer with all untrusted data HTML-escaped."""
    functions = {function.id: function for function in measurement.functions}
    graphs = build_flamegraph_data(measurement)
    cells = []
    ordinal = 0
    for graph in graphs:
        function = functions[graph.function_id]
        rows = []
        for step in graph.steps:
            actions = ", ".join(f"{name}: {count}" for name, count in step.action_distribution.items())
            rows.append(f"""<tr><td>{step.step_index}</td><td>{_escape(actions)}</td>
              <td>{step.present_count}/{step.total_trials}<div class="presence"><span
              style="width:{step.present_count / step.total_trials * 100:.5f}%"></span></div></td>
              <td>{step.avg_duration_ms:.1f} ms</td><td>{_tokens(step.avg_tokens)}</td></tr>""")
        trials_html = []
        for trial in measurement.trials:
            if (trial.trajectory_id, trial.function_id) == (graph.trajectory_id, graph.function_id):
                trials_html.append(_trial_html(trial, ordinal))
                ordinal += 1
        cells.append(f"""<section class="cell" data-function="{_escape(graph.function_id)}"
          data-trajectory="{_escape(graph.trajectory_id)}"><h2>{_escape(graph.trajectory_id)}</h2>
          <div>{_escape(_function_label(function))}</div>
          <p class="identity">{_escape(graph.function_id)}</p>
          <div class="cell-summary"><span>Correct final state: {graph.correct}/{graph.trials} trials</span>
          <span>Recorded cost: {_money(graph.recorded_cost)}</span>
          <span>Missing cost: {graph.missing_cost_trials} trials</span>
          <span>Mean latency: {graph.avg_latency_ms:.1f} ms</span></div>
          <div class="table-scroll"><table><thead><tr><th>Position</th><th>Tool-call / step names</th>
          <th>Present</th><th>Mean latency</th><th>Mean tokens</th></tr></thead>
          <tbody>{''.join(rows)}</tbody></table></div>{''.join(trials_html)}</section>""")
    function_options = "".join(
        f'<option value="{_escape(f.id)}">{_escape(_function_label(f))} / {_escape(f.id[:12])}</option>'
        for f in measurement.functions
    )
    trajectory_options = "".join(
        f'<option value="{_escape(e.id)}">{_escape(e.id)}</option>' for e in measurement.trajectories
    )
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Signal measurement {_escape(measurement.id[:12])}</title><style>{_STYLE}</style></head>
      <body><header><h1>Signal measurement</h1><div class="identity">{_escape(measurement.id)}</div>
      <p class="muted">{_escape(measurement.timestamp.isoformat())} &middot;
      {sum(e.variant_of is None for e in measurement.trajectories)} trajectories &middot;
      {sum(e.variant_of is not None for e in measurement.trajectories)} cosmetic variants &middot; {len(measurement.functions)} functions &middot;
      {len(measurement.trials)} trials</p></header><main><div class="toolbar">
      <label>Function<select id="function-filter"><option value="">All functions</option>{function_options}</select></label>
      <label>Trajectory<select id="trajectory-filter"><option value="">All trajectories</option>{trajectory_options}</select></label>
      </div>{''.join(cells) or '<p>No recorded trials.</p>'}</main>
      <footer>Signal &middot; Measurement {_escape(measurement.id[:12])}</footer>
      <script>const ff=document.getElementById('function-filter');
      const ef=document.getElementById('trajectory-filter');
      function filter(){{document.querySelectorAll('.cell').forEach(cell=>{{
      cell.hidden=(ff.value && cell.dataset.function!==ff.value)||(ef.value && cell.dataset.trajectory!==ef.value);
      }});}}ff.addEventListener('change',filter);ef.addEventListener('change',filter);</script>
      </body></html>"""


def export_html(measurement: Measurement, path: str | Path) -> Path:
    """Write a self-contained HTML run explorer; no server or network is needed."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(html_document(measurement), encoding="utf-8")
    return destination


def render_terminal(measurement: Measurement, console: Any = None) -> None:
    """Print separate outcome, event and process data, followed by goal traces."""
    from rich.console import Console
    from rich.table import Table
    from rich.text import Text

    console = console or Console()
    console.print(Text(f"Signal measurement {measurement.id}", style="bold"))
    for graph in build_flamegraph_data(measurement):
        console.print(Text(f"Trajectory {graph.trajectory_id} | Function {graph.function_id}"))
        console.print(Text(
            f"Outcome: {graph.correct}/{graph.trials} correct final states | "
            f"Process: cost {_money(graph.recorded_cost)} ({graph.missing_cost_trials} unreported), "
            f"mean latency {graph.avg_latency_ms:.1f} ms"
        ))
        table = Table("Position", "Step names", "Present", "Mean ms", "Mean tokens", box=None)
        for step in graph.steps:
            table.add_row(str(step.step_index), Text(
                ", ".join(f"{name}: {count}" for name, count in step.action_distribution.items())
            ), f"{step.present_count}/{step.total_trials}", f"{step.avg_duration_ms:.1f}", _tokens(step.avg_tokens))
        console.print(table)
        for trial in measurement.trials:
            if (trial.trajectory_id, trial.function_id) != (graph.trajectory_id, graph.function_id):
                continue
            console.print(Text(f"  Repetition {trial.repetition}, seed {trial.seed}"))
            for event in trial.grades.events:
                if event.attempted or event.occurred:
                    console.print(Text(
                        f"  Event {event.harm}: attempted={event.attempted}, "
                        f"occurred={event.occurred}, severity={_money(event.severity)}"
                    ))
            for step in trial.transcript.steps:
                goal = " > ".join(str(v) for v in (step.parent_goal, step.goal) if v)
                console.print(Text(
                    f"    {step.index}: {goal + ': ' if goal else ''}{step.name} "
                    f"({step.duration_ms:.1f} ms, {step.tokens} tokens, {_money(step.cost)})"
                ))
