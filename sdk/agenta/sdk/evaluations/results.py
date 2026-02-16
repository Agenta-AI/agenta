from typing import Optional, Dict, Any
from uuid import UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.models.evaluations import EvaluationResult

# TODO: ADD TYPES


async def acreate(
    *,
    run_id: UUID,
    scenario_id: UUID,
    step_key: str,
    # repeat_idx: str,
    # timestamp: datetime,
    # interval: float,
    #
    testcase_id: Optional[UUID] = None,
    trace_id: Optional[str] = None,
    error: Optional[dict] = None,
    #
    flags: Optional[Dict[str, Any]] = None,
    tags: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> EvaluationResult:
    payload = dict(
        results=[
            dict(
                flags=flags,
                tags=tags,
                meta=meta,
                #
                testcase_id=str(testcase_id) if testcase_id else None,
                trace_id=trace_id,
                error=error,
                #
                # interval=interval,
                # timestamp=timestamp,
                # repeat_idx=repeat_idx,
                step_key=step_key,
                run_id=str(run_id),
                scenario_id=str(scenario_id),
                #
                status="success",
            )
        ]
    )

    response = authed_api()(
        method="POST",
        endpoint=f"/preview/evaluations/results/",
        json=payload,
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    result = EvaluationResult(**response["results"][0])

    return result
