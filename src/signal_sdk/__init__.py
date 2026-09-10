"""Signal: measure agent systems with deterministic graders, rulers and paired statistics."""

from .domain import RETURN_VALUES, Domain, ReturnValueEnvironment, TrialContext, field_f1, process_grade
from .experiment import Experiment, evaluate, rate_trials, run_experiment
from .models import (
    Action, AuditSample, ComparisonPlan, ConfirmatoryComparison, EnvironmentDefinition, Trajectory, Event,
    Function, Grades, GraderDefinition, Hazard, Label, Measurement, MeasurementConfig, Message,
    ModelIdentity, Outcome, OutcomeGrade, ProcessGrade, Step, TaskDistribution, Transcript, Trial,
    ValidityPeriod,
)
from .rulers import (
    DEFAULT_RULERS, Ruler, accuracy, agreement_with_grader, apply_rulers, inter_rater_reliability,
    pass_power_k, path_consistency, rate,
)
from .runner import FunctionImplementation, dataset_distribution, measure
from .tracing import TraceRecorder

__version__ = "0.3.0"

__all__ = ["Action", "AuditSample", "ComparisonPlan", "ConfirmatoryComparison", "DEFAULT_RULERS", "Domain",
           "EnvironmentDefinition", "Trajectory", "Event", "Experiment", "Function", "FunctionImplementation", "Grades",
           "GraderDefinition", "Hazard", "Label", "Measurement", "MeasurementConfig", "Message", "ModelIdentity",
           "Outcome", "OutcomeGrade", "ProcessGrade", "RETURN_VALUES", "ReturnValueEnvironment", "Ruler", "Step",
           "TaskDistribution", "TraceRecorder", "Transcript", "Trial", "TrialContext", "ValidityPeriod", "accuracy",
           "agreement_with_grader", "apply_rulers", "dataset_distribution", "evaluate", "field_f1",
           "inter_rater_reliability", "measure", "pass_power_k", "path_consistency", "process_grade", "rate",
           "rate_trials", "run_experiment"]
