import json

import pytest
from fastapi.testclient import TestClient

from signal_sdk.dashboard.app import create_app
from signal_sdk.dashboard.store import DashboardStore, ImmutableConflict
from signal_sdk.models import Message
from signal_sdk.visualization import build_flamegraph_data, html_document


def test_html_escapes_transcript_and_keeps_goals(measurement):
    trial = measurement.trials[0]
    transcript = trial.transcript.model_copy(update={"messages": (Message(role="assistant", content="<script>alert(1)</script>"),)})
    changed = measurement.model_copy(update={"trials": (trial.model_copy(update={"transcript": transcript}), *measurement.trials[1:])})
    html = html_document(changed)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "Reconcile invoice" in html and "Verify authorization" in html
    assert "Outcome" in html and "Events" in html and "Process" in html


def test_trace_sequence_data(measurement):
    graphs = build_flamegraph_data(measurement)
    assert len(graphs) == len(measurement.trajectories) * len(measurement.functions)
    assert all(g.trials == 2 for g in graphs)


def test_store_roundtrip_and_write_once(measurement, tmp_path):
    store = DashboardStore(tmp_path)
    assert store.put(measurement) == measurement.id
    assert store.put(measurement) == measurement.id
    assert store.get(measurement.id).id == measurement.id
    store.put_certificate(measurement.id, {"measurement_id": measurement.id, "value": 1})
    with pytest.raises(ImmutableConflict):
        store.put_certificate(measurement.id, {"measurement_id": measurement.id, "value": 2})


def test_stored_tampering_rejected(measurement, tmp_path):
    store = DashboardStore(tmp_path)
    store.put(measurement)
    path = tmp_path / f"{measurement.id}.measurement.json"
    data = json.loads(path.read_text())
    data["elapsed_seconds"] += 1
    path.write_text(json.dumps(data))
    with pytest.raises(ImmutableConflict):
        store.get(measurement.id)


def test_api_hash_and_trace_access(measurement, tmp_path):
    client = TestClient(create_app(tmp_path))
    body = measurement.model_dump(mode="json")
    assert client.post("/api/measurements", json=body).status_code == 201
    assert client.get(f"/api/measurements/{measurement.id}/trials/0").status_code == 200
    assert client.get(f"/measurements/{measurement.id}").status_code == 200
    body["elapsed_seconds"] += 1
    assert client.post("/api/measurements", json=body).status_code == 409
    assert client.get("/api/measurements/missing").status_code == 404


def test_path_traversal_rejected():
    with pytest.raises(ValueError):
        DashboardStore().get("../../secret")
