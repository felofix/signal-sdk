"""Local, immutable measurement storage and optional dashboard API."""

from signal_sdk.dashboard.app import create_app
from signal_sdk.dashboard.store import DashboardStore, ImmutableConflict

__all__ = ["DashboardStore", "ImmutableConflict", "create_app"]
