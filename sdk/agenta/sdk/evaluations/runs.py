from typing import Optional, Dict, Any
from uuid import UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.models.evaluations import EvaluationRun, Target

import agenta as ag

# TODO: ADD TYPES


async def afetch(
    *,
    run_id: UUID,
) -> Optional[EvaluationRun]:
    response = authed_api()(
        method="GET",
        endpoint=f"/preview/evaluations/runs/{run_id}",
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    if (not "count" in response) or (response["count"] == 0) or (not "run" in response):
        return None

    run = EvaluationRun(**response["run"])

    return run


async def acreate(
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    flags: Optional[Dict[str, Any]] = None,
    tags: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    #
    query_steps: Optional[Target] = None,
    testset_steps: Optional[Target] = None,
    application_steps: Optional[Target] = None,
    evaluator_steps: Optional[Target] = None,
    #
    repeats: Optional[int] = None,
) -> Optional[EvaluationRun]:
    payload = dict(
        evaluation=dict(
            name=name,
            description=description,
            #
            flags=flags,
            tags=tags,
            meta=meta,
            #
            data=dict(
                status="running",
                query_steps=query_steps,
                testset_steps=testset_steps,
                application_steps=application_steps,
                evaluator_steps=evaluator_steps,
                repeats=repeats,
            ),
            #
            jit={"testsets": True, "evaluators": False},
        )
    )

    response = authed_api()(
        method="POST",
        endpoint=f"/preview/simple/evaluations/",
        json=payload,
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    if (not "evaluation" in response) or (not "id" in response["evaluation"]):
        return None

    run_id = UUID(response["evaluation"]["id"])

    return await afetch(run_id=run_id)


async def aclose(
    *,
    run_id: UUID,
    #
    status: Optional[str] = "success",
) -> Optional[EvaluationRun]:
    response = authed_api()(
        method="POST",
        endpoint=f"/preview/evaluations/runs/{run_id}/close/{status}",
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    if (not "run" in response) or (not "id" in response["run"]):
        return None

    run_id = UUID(response["run"]["id"])

    return await afetch(run_id=run_id)


async def aurl(
    *,
    run_id: UUID,
) -> str:
    response = authed_api()(
        method="GET",
        endpoint=f"/projects",
        params={"scope": "project"},
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    if len(response.json()) != 1:
        return None

    project_info = response.json()[0]

    workspace_id = project_info.get("workspace_id")
    project_id = project_info.get("project_id")

    return (
        f"{ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host}"
        f"/w/{workspace_id}"
        f"/p/{project_id}"
        f"/evaluations/results/{run_id}"
    )
