"""Signal: immutable function measurements with deterministic harm graders."""

from .models import (
    Action, AuditSample, ComparisonPlan, ConfirmatoryComparison, DocumentDistribution,
    Episode, Event, Function, Grades, Hazard, Label, Mandate, Measurement,
    MeasurementConfig, Message, ModelIdentity, Outcome, OutcomeGrade, ProcessGrade,
    Step, Transcript, Trial, ValidityPeriod,
)
from .runner import FunctionImplementation, TrialContext, measure

__version__ = "0.1.0"

__all__ = ["Action", "AuditSample", "ComparisonPlan", "ConfirmatoryComparison", "DocumentDistribution",
           "Episode", "Event", "Function", "FunctionImplementation", "Grades", "Hazard", "Label",
           "Mandate", "Measurement", "MeasurementConfig", "Message", "ModelIdentity", "Outcome",
           "OutcomeGrade", "ProcessGrade", "Step", "Transcript", "Trial", "TrialContext", "ValidityPeriod", "measure"]
