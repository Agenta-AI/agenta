from typing import Optional, Dict, Any
from uuid import UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.models.evaluations import EvaluationScenario

# TODO: ADD TYPES


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
        endpoint=f"/preview/evaluations/scenarios/",
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
