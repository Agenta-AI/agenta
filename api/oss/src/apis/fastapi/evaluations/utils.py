from typing import Optional, List
from uuid import UUID
from datetime import datetime
from json import loads

from fastapi import Query

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import Windowing

from oss.src.apis.fastapi.evaluations.models import (
    EvaluationRunQuery,
    EvaluationRunQueryRequest,
    EvaluationScenarioQuery,
    EvaluationScenarioQueryRequest,
    EvaluationStepQuery,
    EvaluationStepQueryRequest,
    EvaluationMetricQuery,
    EvaluationMetricQueryRequest,
)

log = get_module_logger(__name__)


async def parse_run_query_request(
    # FILTERING
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    # ARCHIVING
    include_archived: bool = Query(False),
    # WINDOWING
    next: Optional[UUID] = Query(None),  # pylint: disable=redefined-builtin
    start: Optional[datetime] = Query(None),
    stop: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
) -> EvaluationRunQueryRequest:
    try:
        flags = loads(flags) if flags else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    try:
        tags = loads(tags) if tags else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    try:
        meta = loads(meta) if meta else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    run_query_request = EvaluationRunQueryRequest(
        run=EvaluationRunQuery(
            flags=flags,
            tags=tags,
            meta=meta,
            #
            status=status,
            statuses=statuses,
        ),
        include_archived=include_archived,
        windowing=Windowing(
            next=next,
            start=start,
            stop=stop,
            limit=limit,
        ),
    )

    return run_query_request


async def parse_scenario_query_request(
    # SCOPING
    run_id: Optional[UUID] = Query(None),
    run_ids: Optional[List[UUID]] = Query(None),
    # FILTERING
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    # WINDOWING
    next: Optional[UUID] = Query(None),  # pylint: disable=redefined-builtin
    start: Optional[datetime] = Query(None),
    stop: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
) -> EvaluationScenarioQueryRequest:
    try:
        tags = loads(tags) if tags else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    try:
        meta = loads(meta) if meta else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    scenario_query_request = EvaluationScenarioQueryRequest(
        scenario=EvaluationScenarioQuery(
            tags=tags,
            meta=meta,
            #
            status=status,
            statuses=statuses,
            #
            run_id=run_id,
            run_ids=run_ids,
        ),
        windowing=Windowing(
            next=next,
            start=start,
            stop=stop,
            limit=limit,
        ),
    )

    return scenario_query_request


async def parse_step_query_request(
    # SCOPING
    run_id: Optional[UUID] = Query(None),
    run_ids: Optional[List[UUID]] = Query(None),
    scenario_id: Optional[UUID] = Query(None),
    scenario_ids: Optional[List[UUID]] = Query(None),
    # FILTERING
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    timestamp: Optional[datetime] = Query(None),
    status: Optional[str] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    key: Optional[str] = Query(None),
    keys: Optional[List[str]] = Query(None),
    repeat_id: Optional[UUID] = Query(None),
    repeat_ids: Optional[List[UUID]] = Query(None),
    retry_id: Optional[UUID] = Query(None),
    retry_ids: Optional[List[UUID]] = Query(None),
    # WINDOWING
    next: Optional[UUID] = Query(None),  # pylint: disable=redefined-builtin
    start: Optional[datetime] = Query(None),
    stop: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
) -> EvaluationStepQueryRequest:
    try:
        tags = loads(tags) if tags else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    try:
        meta = loads(meta) if meta else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    step_query_request = EvaluationStepQueryRequest(
        step=EvaluationStepQuery(
            tags=tags,
            meta=meta,
            #
            timestamp=timestamp,
            status=status,
            statuses=statuses,
            #
            key=key,
            keys=keys,
            repeat_id=repeat_id,
            repeat_ids=repeat_ids,
            retry_id=retry_id,
            retry_ids=retry_ids,
            #
            scenario_id=scenario_id,
            scenario_ids=scenario_ids,
            run_id=run_id,
            run_ids=run_ids,
        ),
        windowing=Windowing(
            next=next,
            start=start,
            stop=stop,
            limit=limit,
        ),
    )

    return step_query_request


async def parse_metric_query_request(
    # SCOPING
    run_id: Optional[UUID] = Query(None),
    run_ids: Optional[List[UUID]] = Query(None),
    scenario_id: Optional[UUID] = Query(None),
    scenario_ids: Optional[List[UUID]] = Query(None),
    # FILTERING
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    # WINDOWING
    next: Optional[UUID] = Query(None),  # pylint: disable=redefined-builtin
    start: Optional[datetime] = Query(None),
    stop: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
) -> EvaluationMetricQueryRequest:
    try:
        meta = loads(meta) if meta else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    metric_query_request = EvaluationMetricQueryRequest(
        metric=EvaluationMetricQuery(
            tags=tags,
            meta=meta,
            #
            status=status,
            statuses=statuses,
            #
            scenario_id=scenario_id,
            scenario_ids=scenario_ids,
            run_id=run_id,
            run_ids=run_ids,
        ),
        windowing=Windowing(
            next=next,
            start=start,
            stop=stop,
            limit=limit,
        ),
    )

    return metric_query_request
