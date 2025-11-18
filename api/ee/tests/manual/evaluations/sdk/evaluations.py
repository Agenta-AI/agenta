from typing import Optional, Dict, Any
from uuid import uuid4, UUID

import unicodedata
import re

from definitions import (
    EvaluationRun,
    EvaluationScenario,
    EvaluationResult,
    EvaluationMetrics,
    Origin,
    Target,
)

from client import authed_api


client = authed_api()


async def create_run(
    *,
    flags: Optional[Dict[str, Any]] = None,
    tags: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    #
    query_steps: Optional[Target] = None,
    testset_steps: Optional[Target] = None,
    application_steps: Optional[Target] = None,
    evaluator_steps: Optional[Target] = None,
    repeats: Optional[int] = None,
) -> EvaluationRun:
    payload = dict(
        evaluation=dict(
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
        )
    )

    response = client(
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

    run = EvaluationRun(id=UUID(response["evaluation"]["id"]))

    return run


async def add_scenario(
    *,
    flags: Optional[Dict[str, Any]] = None,
    tags: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    #
    run_id: UUID,
) -> EvaluationScenario:
    payload = dict(
        scenarios=[
            dict(
                flags=flags,
                tags=tags,
                meta=meta,
                #
                run_id=str(run_id),
            )
        ]
    )

    response = client(
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


async def log_result(
    *,
    flags: Optional[Dict[str, Any]] = None,
    tags: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    #
    testcase_id: Optional[UUID] = None,
    trace_id: Optional[str] = None,
    error: Optional[dict] = None,
    #
    # timestamp: datetime,
    # repeat_idx: str,
    step_key: str,
    run_id: UUID,
    scenario_id: UUID,
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
            )
        ]
    )

    response = client(
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


async def compute_metrics(
    run_id: UUID,
) -> EvaluationMetrics:
    payload = dict(
        run_id=str(run_id),
    )

    response = client(
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


def get_slug_from_name_and_id(
    name: str,
    id: UUID,  # pylint: disable=redefined-builtin
) -> str:
    # Normalize Unicode (e.g., é → e)
    name = unicodedata.normalize("NFKD", name)
    # Remove non-ASCII characters
    name = name.encode("ascii", "ignore").decode("ascii")
    # Lowercase and remove non-word characters except hyphens and spaces
    name = re.sub(r"[^\w\s-]", "", name.lower())
    # Replace any sequence of hyphens or whitespace with a single hyphen
    name = re.sub(r"[-\s]+", "-", name)
    # Trim leading/trailing hyphens
    name = name.strip("-")
    # Last 12 characters of the ID
    slug = f"{name}-{id.hex[-12:]}"

    return slug.lower()
