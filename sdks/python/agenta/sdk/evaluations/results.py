from typing import Optional, Dict, Any, List
from uuid import UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.models.evaluations import EvaluationResult

# TODO: ADD TYPES


async def apopulate(
    *,
    results: List[Dict[str, Any]],
) -> List[EvaluationResult]:
    """Bulk-write finished result cells in one call (the `populate_slice` op).

    Mirrors `POST /simple/evaluations/{id}/populate`: each item is a fully-formed
    result cell (run_id, scenario_id, step_key, repeat_idx, status, and the
    trace_id/testcase_id/error it carries). Callers that computed cells
    themselves (the SDK local evaluator) write them all at once here instead of
    one `acreate` per cell. `run_id` is taken from the cells, not the path
    builder, so every cell must carry its own.
    """
    if not results:
        return []

    run_ids = {r.get("run_id") for r in results}
    if len(run_ids) != 1 or None in run_ids:
        raise ValueError(
            "apopulate requires all result cells to carry the same run_id."
        )
    run_id = run_ids.pop()

    response = authed_api()(
        method="POST",
        endpoint=f"/simple/evaluations/{run_id}/populate",
        json=dict(results=results),
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    return [EvaluationResult(**r) for r in response.get("results", [])]


async def acreate(
    *,
    run_id: UUID,
    scenario_id: UUID,
    step_key: str,
    repeat_idx: Optional[int] = 0,
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
                repeat_idx=repeat_idx,
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
        endpoint="/evaluations/results/",
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
