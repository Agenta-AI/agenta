from datetime import datetime
from typing import Optional, Dict, Any, List
from uuid import UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.models.evaluations import EvaluationScenario

# TODO: ADD TYPES


async def aadd(
    *,
    run_id: UUID,
    count: int,
    timestamp: Optional[datetime] = None,
) -> List[EvaluationScenario]:
    """Bulk-mint `count` skeleton scenarios for a run (the `add_scenarios` op).

    Mirrors `POST /simple/evaluations/{id}/scenarios/add`: skeleton rows with no
    cells, returned in order so the caller can bind result cells to their ids.
    `timestamp` buckets them on the temporal axis (live runs); None otherwise.
    """
    if count <= 0:
        return []

    payload: Dict[str, Any] = {"count": count}
    if timestamp is not None:
        payload["timestamp"] = timestamp.isoformat()

    response = authed_api()(
        method="POST",
        endpoint=f"/simple/evaluations/{run_id}/scenarios/add",
        json=payload,
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    return [EvaluationScenario(**s) for s in response.get("scenarios", [])]


async def acreate(
    *,
    run_id: UUID,
    #
    flags: Optional[Dict[str, Any]] = None,
    tags: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> EvaluationScenario:
    payload = dict(
        scenarios=[
            dict(
                flags=flags,
                tags=tags,
                meta=meta,
                #
                run_id=str(run_id),
                #
                status="success",
            )
        ]
    )

    response = authed_api()(
        method="POST",
        endpoint="/evaluations/scenarios/",
        json=payload,
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    scenario = EvaluationScenario(**response["scenarios"][0])

    return scenario
