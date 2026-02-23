from enum import Enum


class FlowType(str, Enum):
    """Execution flow kind that produced an event."""

    UNKNOWN = "unknown"
    # Future examples:
    # HTTP = "http"
    # WORKER = "worker"
    # CRON = "cron"


class EventType(str, Enum):
    """Top-level event classification."""

    UNKNOWN = "unknown"
    # Future examples:
    # CONFIG_DEPLOYED = "config.deployed"
    # EVALUATION_COMPLETED = "evaluation.completed"
