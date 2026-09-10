"""Local API for immutable measurements and their execution traces."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import ValidationError

from signal_sdk.dashboard.store import DashboardStore, ImmutableConflict
from signal_sdk.models import Measurement
from signal_sdk.visualization import html_document


def create_app(data_dir: str | Path | None = None) -> Any:
    """Create a local dashboard API; install the ``dashboard`` extra to serve it."""
    try:
        from fastapi import FastAPI, HTTPException, Query
        from fastapi.responses import HTMLResponse
    except ImportError as error:
        raise ImportError("Install the dashboard extra: pip install 'signal-risk-sdk[dashboard]'") from error

    app = FastAPI(title="Signal measurements", version="0.1.0")
    store = DashboardStore(data_dir)
    app.state.store = store

    def find(measurement_id: str) -> Measurement:
        try:
            measurement = store.get(measurement_id)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        if measurement is None:
            raise HTTPException(status_code=404, detail="Measurement not found")
        return measurement

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/runs", include_in_schema=False)
    @app.post("/api/measurements", status_code=201)
    def record_measurement(body: dict[str, Any]) -> dict[str, str]:
        try:
            measurement = Measurement.model_validate(body)
            if body.get("id") is not None and body["id"] != measurement.id:
                raise ImmutableConflict("Submitted measurement ID does not match its content hash")
            store.put(measurement)
        except ImmutableConflict as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except (ValueError, ValidationError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {"id": measurement.id}

    @app.get("/api/runs", include_in_schema=False)
    @app.get("/api/measurements")
    def list_measurements(limit: int = Query(100, ge=1, le=1000), function_id: str | None = None) -> list[dict[str, Any]]:
        result = []
        for measurement in store.list(limit, function_id):
            costs = [t.grades.process.cost for t in measurement.trials]
            result.append({
                "id": measurement.id,
                "timestamp": measurement.timestamp.isoformat(),
                "function_ids": [f.id for f in measurement.functions],
                "trajectories": len(measurement.trajectories),
                "trials": len(measurement.trials),
                "recorded_cost": str(sum(c for c in costs if c is not None)),
                "missing_cost_trials": sum(c is None for c in costs),
                "latency_ms": sum(t.grades.process.latency_ms for t in measurement.trials),
            })
        return result

    @app.get("/api/runs/{measurement_id}", include_in_schema=False)
    @app.get("/api/measurements/{measurement_id}")
    def get_measurement(measurement_id: str) -> dict[str, Any]:
        return find(measurement_id).model_dump(mode="json")

    @app.get("/api/measurements/{measurement_id}/trials")
    def list_trials(measurement_id: str, trajectory_id: str | None = None, function_id: str | None = None) -> list[dict[str, Any]]:
        return [t.model_dump(mode="json") for t in find(measurement_id).trials
                if (trajectory_id is None or t.trajectory_id == trajectory_id)
                and (function_id is None or t.function_id == function_id)]

    @app.get("/api/measurements/{measurement_id}/trials/{trial_index}")
    def get_trial(measurement_id: str, trial_index: int) -> dict[str, Any]:
        measurement = find(measurement_id)
        if not 0 <= trial_index < len(measurement.trials):
            raise HTTPException(status_code=404, detail="Trial not found")
        return measurement.trials[trial_index].model_dump(mode="json")

    @app.post("/api/measurements/{measurement_id}/certificate", status_code=201)
    def store_certificate(measurement_id: str, body: dict[str, Any]) -> dict[str, str]:
        find(measurement_id)
        try:
            store.put_certificate(measurement_id, body)
        except ImmutableConflict as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {"measurement_id": measurement_id}

    @app.get("/api/measurements/{measurement_id}/certificate")
    def get_certificate(measurement_id: str) -> dict[str, Any]:
        find(measurement_id)
        certificate = store.get_certificate(measurement_id)
        if certificate is None:
            raise HTTPException(status_code=404, detail="Certificate not found")
        return certificate

    @app.get("/measurements/{measurement_id}", response_class=HTMLResponse)
    def view_measurement(measurement_id: str) -> str:
        return html_document(find(measurement_id))

    return app
