from typing import Optional, Dict, Any

from pydantic import BaseModel
from uuid import UUID

from agenta.sdk.utils.client import authed_async_api
from agenta.sdk.models.evaluations import EvaluationRun, Origin, Target

import agenta as ag


class RunData(BaseModel):
    """Typed input contract for `acreate` — the RESOLVED run-creation payload.

    Callers assemble a `RunData` and pass its fields to `acreate` explicitly
    (`acreate(name=run_data.name, ...)`), keeping the create call's surface
    visible at the call site while resolving the data in one place.

    `*_steps` are typed `Dict[str, Origin]` (revision-id-keyed), NOT the loose
    `Target` `acreate` accepts: by the time a `RunData` exists, every step is
    resolved to a `{revision_id: origin}` map. Using `Target` here would let
    pydantic coerce the string keys back to UUID (the `Dict[UUID, Origin]` union
    member), which then fails to JSON-serialize.
    """

    name: Optional[str] = None
    description: Optional[str] = None
    #
    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    #
    query_steps: Optional[Dict[str, Origin]] = None
    testset_steps: Optional[Dict[str, Origin]] = None
    application_steps: Optional[Dict[str, Origin]] = None
    evaluator_steps: Optional[Dict[str, Origin]] = None
    #
    repeats: Optional[int] = None


# TODO: ADD TYPES


async def afetch(
    *,
    run_id: UUID,
) -> Optional[EvaluationRun]:
    response = await authed_async_api()(
        method="GET",
        endpoint=f"/evaluations/runs/{run_id}",
    )

    try:
        response.raise_for_status()
    except Exception:
        print(response.text)
        raise

    response = response.json()

    if ("count" not in response) or (response["count"] == 0) or ("run" not in response):
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
        ),
    )

    response = await authed_async_api()(
        method="POST",
        endpoint="/simple/evaluations/",
        json=payload,
    )

    try:
        response.raise_for_status()
    except Exception:
        print(response.text)
        raise

    response = response.json()

    if ("evaluation" not in response) or ("id" not in response["evaluation"]):
        return None

    run_id = UUID(response["evaluation"]["id"])

    return await afetch(run_id=run_id)


async def aclose(
    *,
    run_id: UUID,
    #
    status: Optional[str] = "success",
) -> Optional[EvaluationRun]:
    response = await authed_async_api()(
        method="POST",
        endpoint=f"/evaluations/runs/{run_id}/close",
        params={"status": status} if status else None,
    )

    try:
        response.raise_for_status()
    except Exception:
        print(response.text)
        raise

    response = response.json()

    if ("run" not in response) or ("id" not in response["run"]):
        return None

    run_id = UUID(response["run"]["id"])

    return await afetch(run_id=run_id)


async def aurl(
    *,
    run_id: UUID,
) -> Optional[str]:
    response = await authed_async_api()(
        method="GET",
        endpoint="/projects/current",
    )

    try:
        response.raise_for_status()
    except Exception:
        print(response.text)
        raise

    project_info = response.json()

    if not project_info:
        return None

    workspace_id = project_info.get("workspace_id")
    project_id = project_info.get("project_id")

    return (
        f"{ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host}"
        f"/w/{workspace_id}"
        f"/p/{project_id}"
        f"/evaluations/results/{run_id}"
    )
