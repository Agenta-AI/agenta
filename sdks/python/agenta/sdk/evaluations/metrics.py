from typing import Optional
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
