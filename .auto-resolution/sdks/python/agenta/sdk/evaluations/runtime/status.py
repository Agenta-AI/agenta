from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from agenta.sdk.models.evaluations import EvaluationStatus


class ProcessedScenario(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    scenario: Any
    results: Dict[str, Any] = Field(default_factory=dict)
    metrics: Optional[Any] = None
    has_pending: bool = False
    has_errors: bool = False
    auto_results_created: bool = False


def scenario_status(
    *,
    has_errors: bool,
    has_pending: bool,
) -> EvaluationStatus:
    """The terminal status of a single scenario from its touched cells.

    Identical ranking on every driver: any error ranks the scenario ERRORS,
    else any unresolved cell ranks it PENDING, else SUCCESS.
    """
    if has_errors:
        return EvaluationStatus.ERRORS
    if has_pending:
        return EvaluationStatus.PENDING
    return EvaluationStatus.SUCCESS


def run_status(processed: List[ProcessedScenario]) -> EvaluationStatus:
    """The run status rolled up from a slice's touched scenarios.

    One shared rollup for every driver: ERRORS if any scenario errored, else
    RUNNING if any is still pending (the run is not done), else SUCCESS. Drivers
    apply this verdict in their own way — the SDK closes the run with it; the API
    feeds it into the cross-slice floor — but the verdict itself lives here, next
    to the per-scenario `scenario_status`, so it is computed in exactly one place.

    Lives in this leaf module (not `processor`) so `executor` can import it at
    module load: `processor` imports `executor`, so the status helpers could not
    live in `processor` without forcing `executor` into a dynamic import.
    """
    if any(item.has_errors for item in processed):
        return EvaluationStatus.ERRORS
    if any(item.has_pending for item in processed):
        return EvaluationStatus.RUNNING
    return EvaluationStatus.SUCCESS
