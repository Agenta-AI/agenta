from typing import List, Optional
from uuid import UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.models.evaluations import EvaluationMetrics

# TODO: ADD TYPES


async def aquery_global(
    *,
    run_id: UUID,
) -> Optional[EvaluationMetrics]:
    """Read back the GLOBAL (whole-run) metric row for a run.

    Mirrors `POST /evaluations/metrics/query` with the global selector
    `scenario_ids=False, timestamps=False` — the DAO reads these bools as
    "scenario_id IS NULL" and "timestamp IS NULL", i.e. the single aggregate row
    (not the per-scenario/variational or temporal rows). The SDK calls this
    after executing+refreshing to surface the run's headline metrics.
    """
    response = authed_api()(
        method="POST",
        endpoint="/evaluations/metrics/query",
        json=dict(
            metrics=dict(
                run_id=str(run_id),
                scenario_ids=False,
                timestamps=False,
            )
        ),
    )

    try:
        response.raise_for_status()
    except Exception:
        print(response.text)
        raise

    response = response.json()

    metrics = [EvaluationMetrics(**m) for m in response.get("metrics", [])]
    return metrics[0] if metrics else None


async def arefresh(
    run_id: UUID,
    scenario_id: Optional[UUID] = None,
    # timestamp: Optional[str] = None,
    # interval: Optional[float] = None,
) -> EvaluationMetrics:
    metrics = dict(
        run_id=str(run_id),
        scenario_id=str(scenario_id) if scenario_id else None,
    )

    response = authed_api()(
        method="POST",
        endpoint="/evaluations/metrics/refresh",
        json=dict(metrics=metrics),
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    metrics = EvaluationMetrics(**response["metrics"][0])

    return metrics


async def arefresh_slice(
    *,
    run_id: UUID,
    scenario_ids: Optional[List[UUID]] = None,
    step_keys: Optional[List[str]] = None,
    repeat_idxs: Optional[List[int]] = None,
) -> None:
    """Recompute metrics over a slice scope (variational + aggregate).

    The slice-op counterpart of `arefresh`: callers that wrote finished cells
    themselves (e.g. the SDK local evaluator, which runs workflows in-process
    and populates the results) call this once to roll up the metric rows for the
    addressed scope without executing anything. Mirrors `POST
    /simple/evaluations/{id}/refresh` (204, no body).
    """
    payload = dict(
        scenario_ids=[str(s) for s in scenario_ids] if scenario_ids else None,
        step_keys=step_keys,
        repeat_idxs=repeat_idxs,
    )

    response = authed_api()(
        method="POST",
        endpoint=f"/simple/evaluations/{run_id}/refresh",
        json={k: v for k, v in payload.items() if v is not None},
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise
