from typing import Optional
from uuid import UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.models.evaluations import EvaluationMetrics

# TODO: ADD TYPES


async def arefresh(
    run_id: UUID,
    scenario_id: Optional[UUID] = None,
    # timestamp: Optional[str] = None,
    # interval: Optional[float] = None,
) -> EvaluationMetrics:
    payload = dict(
        run_id=str(run_id),
        scenario_id=str(scenario_id) if scenario_id else None,
    )

    response = authed_api()(
        method="POST",
        endpoint=f"/preview/evaluations/metrics/refresh",
        params=payload,
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    metrics = EvaluationMetrics(**response["metrics"][0])

    return metrics
