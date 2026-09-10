"""Paired, clustered analyses. No composite score or model-based grading."""

from .core import compare, detectable_difference, interval, sample_size, summarize
from .calibration import calibrate, robustness
from .drift import detect_drift
from .loss import loss_distribution
from .difficulty import difficulty

__all__ = ["compare", "detectable_difference", "interval", "sample_size", "summarize",
           "calibrate", "robustness", "detect_drift", "loss_distribution", "difficulty"]
