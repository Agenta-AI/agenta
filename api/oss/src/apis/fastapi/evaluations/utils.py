from typing import Optional, List, Literal
from uuid import UUID
from datetime import datetime
from functools import wraps

from fastapi import Query

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import (
    Windowing,
)
from oss.src.core.evaluations.types import (
    EvaluationStatus,
    EvaluationRunQueryFlags,
    EvaluationQueueFlags,
    #
    EvaluationClosedConflict,
)

from oss.src.apis.fastapi.shared.utils import (
    parse_metadata,
)
from oss.src.apis.fastapi.evaluations.models import (
    EvaluationRunQuery,
    EvaluationRunQueryRequest,
    #
    EvaluationScenarioQuery,
    EvaluationScenarioQueryRequest,
    #
    EvaluationResultQuery,
    EvaluationResultQueryRequest,
    #
    EvaluationMetricsQuery,
    EvaluationMetricsQueryRequest,
    #
    EvaluationQueueQuery,
    EvaluationQueueQueryRequest,
    #
    EvaluationClosedException,
)

log = get_module_logger(__name__)


def handle_evaluation_closed_exception():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except EvaluationClosedConflict as e:
                raise EvaluationClosedException(
                    message=e.message,
                    run_id=e.run_id,
                    scenario_id=e.scenario_id,
                    result_id=e.result_id,
                    metrics_id=e.metrics_id,
                ) from e
            except Exception as e:
                raise e

        return wrapper

    return decorator


async def parse_run_query_request(
    ids: Optional[List[UUID]] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    status: Optional[EvaluationStatus] = Query(None),
    statuses: Optional[List[EvaluationStatus]] = Query(None),
    # WINDOWING
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    next: Optional[UUID] = Query(None),  # pylint: disable=redefined-builtin
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> EvaluationRunQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = None
    try:
        __flags = EvaluationRunQueryFlags(**_flags) if _flags else None  # type: ignore
    except Exception:
        pass

    run_query_request = EvaluationRunQueryRequest(
        run=EvaluationRunQuery(
            flags=__flags,
            tags=_tags,
            meta=_meta,
            #
            status=status,
            statuses=statuses,
            #
            ids=ids,
        ),
        #
        windowing=Windowing(
            newest=newest,
            oldest=oldest,
            next=next,
            limit=limit,
            order=order,
        ),
    )

    return run_query_request


async def parse_scenario_query_request(
    ids: Optional[List[UUID]] = Query(None),
    #
    run_id: Optional[UUID] = Query(None),
    run_ids: Optional[List[UUID]] = Query(None),
    timestamp: Optional[datetime] = Query(None),
    timestamps: Optional[List[datetime]] = Query(None),
    interval: Optional[int] = Query(None),
    intervals: Optional[List[int]] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    status: Optional[EvaluationStatus] = Query(None),
    statuses: Optional[List[EvaluationStatus]] = Query(None),
    # WINDOWING
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    next: Optional[UUID] = Query(None),  # pylint: disable=redefined-builtin
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> EvaluationScenarioQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    scenario_query_request = EvaluationScenarioQueryRequest(
        scenario=EvaluationScenarioQuery(
            flags=_flags,
            tags=_tags,
            meta=_meta,
            #
            status=status,
            statuses=statuses,
            #
            interval=interval,
            intervals=intervals,
            timestamp=timestamp,
            timestamps=timestamps,
            run_id=run_id,
            run_ids=run_ids,
            #
            ids=ids,
        ),
        windowing=Windowing(
            newest=newest,
            oldest=oldest,
            next=next,
            limit=limit,
            order=order,
        ),
    )

    return scenario_query_request


async def parse_result_query_request(
    ids: Optional[List[UUID]] = Query(None),
    #
    run_id: Optional[UUID] = Query(None),
    run_ids: Optional[List[UUID]] = Query(None),
    scenario_id: Optional[UUID] = Query(None),
    scenario_ids: Optional[List[UUID]] = Query(None),
    step_key: Optional[str] = Query(None),
    step_keys: Optional[List[str]] = Query(None),
    repeat_idx: Optional[int] = Query(None),
    repeat_idxs: Optional[List[int]] = Query(None),
    timestamp: Optional[datetime] = Query(None),
    timestamps: Optional[List[datetime]] = Query(None),
    interval: Optional[int] = Query(None),
    intervals: Optional[List[int]] = Query(None),
    #
    status: Optional[EvaluationStatus] = Query(None),
    statuses: Optional[List[EvaluationStatus]] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    # WINDOWING
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    next: Optional[UUID] = Query(None),  # pylint: disable=redefined-builtin
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> EvaluationResultQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    result_query_request = EvaluationResultQueryRequest(
        result=EvaluationResultQuery(
            flags=_flags,
            tags=_tags,
            meta=_meta,
            #
            status=status,
            statuses=statuses,
            #
            interval=interval,
            intervals=intervals,
            timestamp=timestamp,
            timestamps=timestamps,
            repeat_idx=repeat_idx,
            repeat_idxs=repeat_idxs,
            step_key=step_key,
            step_keys=step_keys,
            scenario_id=scenario_id,
            scenario_ids=scenario_ids,
            run_id=run_id,
            run_ids=run_ids,
            #
            ids=ids,
        ),
        windowing=Windowing(
            newest=newest,
            oldest=oldest,
            next=next,
            limit=limit,
            order=order,
        ),
    )

    return result_query_request


async def parse_metrics_query_request(
    ids: Optional[List[UUID]] = Query(None),
    #
    run_id: Optional[UUID] = Query(None),
    run_ids: Optional[List[UUID]] = Query(None),
    scenario_id: Optional[UUID] = Query(None),
    scenario_ids: Optional[List[UUID]] = Query(None),
    timestamp: Optional[datetime] = Query(None),
    timestamps: Optional[List[datetime]] = Query(None),
    interval: Optional[int] = Query(None),
    intervals: Optional[List[int]] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    status: Optional[EvaluationStatus] = Query(None),
    statuses: Optional[List[EvaluationStatus]] = Query(None),
    # WINDOWING
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    next: Optional[UUID] = Query(None),  # pylint: disable=redefined-builtin
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> EvaluationMetricsQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    metrics_query_request = EvaluationMetricsQueryRequest(
        metrics=EvaluationMetricsQuery(
            flags=_flags,
            tags=_tags,
            meta=_meta,
            #
            status=status,
            statuses=statuses,
            #
            interval=interval,
            intervals=intervals,
            timestamp=timestamp,
            timestamps=timestamps,
            scenario_id=scenario_id,
            scenario_ids=scenario_ids,
            run_id=run_id,
            run_ids=run_ids,
            #
            ids=ids,
        ),
        windowing=Windowing(
            newest=newest,
            oldest=oldest,
            next=next,
            limit=limit,
            order=order,
        ),
    )

    return metrics_query_request


async def parse_queue_query_request(
    ids: Optional[List[UUID]] = Query(None),
    #
    run_id: Optional[UUID] = Query(None),
    run_ids: Optional[List[UUID]] = Query(None),
    user_id: Optional[UUID] = Query(None),
    user_ids: Optional[List[UUID]] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    # WINDOWING
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    next: Optional[UUID] = Query(None),  # pylint: disable=redefined-builtin
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> EvaluationQueueQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = None
    try:
        __flags = EvaluationQueueFlags(**_flags) if _flags else None  # type: ignore
    except Exception:
        pass

    queue_query_request = EvaluationQueueQueryRequest(
        queue=EvaluationQueueQuery(
            flags=__flags,
            tags=_tags,
            meta=_meta,
            #
            run_id=run_id,
            run_ids=run_ids,
            user_id=user_id,
            user_ids=user_ids,
            ids=ids,
        ),
        windowing=Windowing(
            newest=newest,
            oldest=oldest,
            next=next,
            limit=limit,
            order=order,
        ),
    )

    return queue_query_request
