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


async def aedit_scenario(
    *,
    scenario_id: UUID,
    status: str,
    tags: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Optional[EvaluationScenario]:
    """Edit a single scenario (status, and optionally tags/meta).

    Mirrors `PATCH /evaluations/scenarios/{scenario_id}` (operation
    `edit_scenario`); the body's `scenario.id` must match the path id. Used by
    the SDK evaluate loop's `edit_scenario` adapter to flip each scenario to its
    computed SUCCESS/ERRORS/PENDING status after its cells are written.

    Carries `tags`/`meta` like the API's `APIScenarioEditor`, and tolerates a
    run closed mid-flight: the API returns 409 (EvaluationClosedException) for an
    edit against a locked run — closing is a lock, not a failure, so we return
    None rather than raising, matching the API adapter's
    `except EvaluationClosedConflict`.
    """
    scenario: Dict[str, Any] = dict(
        id=str(scenario_id),
        status=status,
    )
    if tags is not None:
        scenario["tags"] = tags
    if meta is not None:
        scenario["meta"] = meta

    response = authed_api()(
        method="PATCH",
        endpoint=f"/evaluations/scenarios/{scenario_id}",
        json=dict(scenario=scenario),
    )

    # Run closed (locked) mid-flight -> 409. Skip the write, don't raise.
    if response.status_code == 409:
        return None

    try:
        response.raise_for_status()
    except Exception:
        print(response.text)
        raise

    response = response.json()

    scenario_data = response.get("scenario")
    return EvaluationScenario(**scenario_data) if scenario_data else None
