"""Append-only JSON storage for measurements and their certificates."""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from threading import RLock
from typing import Any

from signal_sdk.models import Measurement


class ImmutableConflict(ValueError):
    """A stored measurement or certificate cannot be replaced."""


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("utf-8")


def _safe_id(identifier: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", identifier):
        raise ValueError("Invalid measurement identifier")
    return identifier


class DashboardStore:
    """Create-only storage. Repeating an identical write is idempotent."""

    def __init__(self, data_dir: str | Path | None = None) -> None:
        self.data_dir = Path(data_dir) if data_dir is not None else None
        self._memory: dict[tuple[str, str], bytes] = {}
        self._lock = RLock()
        if self.data_dir is not None:
            self.data_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, kind: str, identifier: str) -> Path:
        assert self.data_dir is not None
        return self.data_dir / f"{_safe_id(identifier)}.{kind}.json"

    def _read(self, kind: str, identifier: str) -> bytes | None:
        _safe_id(identifier)
        if self.data_dir is None:
            with self._lock:
                return self._memory.get((kind, identifier))
        try:
            return self._path(kind, identifier).read_bytes()
        except FileNotFoundError:
            return None

    def _put(self, kind: str, identifier: str, value: Any) -> None:
        _safe_id(identifier)
        content = _canonical(value)
        with self._lock:
            previous = self._read(kind, identifier)
            if previous is not None:
                if previous != content:
                    raise ImmutableConflict(f"{kind.capitalize()} {identifier} already exists with different content")
                return
            if self.data_dir is None:
                self._memory[kind, identifier] = content
                return
            destination = self._path(kind, identifier)
            temporary: str | None = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.data_dir, delete=False) as stream:
                    temporary = stream.name
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                # Hard-link creation atomically refuses an existing destination,
                # including a simultaneous writer in a different process.
                try:
                    os.link(temporary, destination)
                except FileExistsError:
                    if destination.read_bytes() != content:
                        raise ImmutableConflict(f"{kind.capitalize()} {identifier} already exists with different content") from None
            finally:
                if temporary is not None:
                    Path(temporary).unlink(missing_ok=True)

    def put(self, measurement: Measurement) -> str:
        """Persist a content-addressed snapshot without modifying existing data."""
        self._put("measurement", measurement.id, measurement.model_dump(mode="json"))
        return measurement.id

    def get(self, measurement_id: str) -> Measurement | None:
        content = self._read("measurement", measurement_id)
        if content is None:
            return None
        measurement = Measurement.model_validate(json.loads(content))
        if measurement.id != measurement_id:
            raise ImmutableConflict("Stored measurement does not match its content hash")
        return measurement

    def list(self, limit: int = 100, function_id: str | None = None) -> list[Measurement]:
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be between 1 and 1000")
        if self.data_dir is None:
            with self._lock:
                ids = [identifier for kind, identifier in self._memory if kind == "measurement"]
        else:
            ids = [path.name.removesuffix(".measurement.json") for path in self.data_dir.glob("*.measurement.json")]
        measurements = [self.get(identifier) for identifier in ids]
        found = [m for m in measurements if m is not None and (
            function_id is None or any(f.id == function_id for f in m.functions)
        )]
        return sorted(found, key=lambda m: m.timestamp, reverse=True)[:limit]

    def put_certificate(self, measurement_id: str, certificate: Any) -> None:
        """Attach a write-once JSON certificate bound to an existing measurement."""
        if self.get(measurement_id) is None:
            raise KeyError(measurement_id)
        if hasattr(certificate, "model_dump"):
            certificate = certificate.model_dump(mode="json")
        if not isinstance(certificate, dict):
            raise ValueError("Certificate must be a JSON object")
        if certificate.get("measurement_id") != measurement_id:
            raise ValueError("Certificate measurement_id must match the stored measurement")
        self._put("certificate", measurement_id, certificate)

    def get_certificate(self, measurement_id: str) -> dict[str, Any] | None:
        content = self._read("certificate", measurement_id)
        return json.loads(content) if content is not None else None
