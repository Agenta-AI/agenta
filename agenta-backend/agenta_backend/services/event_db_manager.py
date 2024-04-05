import logging
from typing import List
from functools import partial
from datetime import datetime

from fastapi import HTTPException

from agenta_backend.models.api.api_models import PaginationParam, SorterParams
from agenta_backend.models.api.observability_models import (
    Error,
    Span,
    SpanDetail,
    CreateSpan,
    ObservabilityDashboardData,
    Feedback,
    CreateFeedback,
    SpanStatus,
    UpdateFeedback,
    Trace,
    TraceDetail,
    CreateTrace,
    UpdateTrace,
    ObservabilityData,
    GenerationFilterParams,
    ObservabilityDashboardDataRequestParams,
)
from agenta_backend.models.converters import (
    spans_to_pydantic,
    traces_to_pydantic,
    feedback_db_to_pydantic,
    trace_db_to_pydantic,
    get_paginated_data,
    get_pagination_skip_limit,
)
from agenta_backend.services import db_manager, filters, helpers
from agenta_backend.models.db_models import (
    TraceDB,
    Feedback as FeedbackDB,
    SpanDB,
)

import pymongo
from beanie.operators import In
from beanie import PydanticObjectId as ObjectId


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


async def create_app_trace(payload: CreateTrace) -> str:
    """Create a new trace.

    Args:
        payload (CreateTrace): the required payload

    Returns:
        Trace: the created trace
    """

    trace_db = TraceDB(
        **payload.dict(exclude={"environment", "id"}),
        id=ObjectId(payload.id),
        environment="playground" if not payload.environment else payload.environment,
    )
    await trace_db.create()
    return str(trace_db.id)


async def get_trace_single(trace_id: str) -> Trace:
    """Get a single trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        Trace: the trace
    """

    # Get trace
    trace = await TraceDB.find_one(
        TraceDB.id == ObjectId(trace_id),
    )
    return trace_db_to_pydantic(trace)


async def trace_update(trace_id: str, payload: UpdateTrace) -> bool:
    """Update status of trace.

    Args:
        trace_id (str): the Id of the trace
        payload (UpdateTrace): the required payload

    Returns:
        bool: True if successful
    """

    trace = await TraceDB.find_one(TraceDB.id == ObjectId(trace_id))

    await trace.update(
        {
            "$set": {
                **payload.dict(exclude_none=True),
            },
        }
    )
    return True


async def create_trace_span(payload: CreateSpan) -> str:
    """Create a new span for a given trace.

    Args:
        payload (CreateSpan): the required payload

    Returns:
        str: the created span id
    """

    trace = await TraceDB.find_one(TraceDB.id == ObjectId(payload.trace_id))
    span_db = SpanDB(
        **payload.dict(
            exclude={"end_time", "trace_id", "span_id", "end_time", "environment"}
        ),
        id=ObjectId(payload.span_id),
        trace=trace,
        environment="playground" if not payload.environment else payload.environment,
        end_time=payload.end_time,
    )
    await span_db.create()
    return str(span_db.id)


async def fetch_generation_spans(
    app_id: str,
    pagination: PaginationParam,
    filters_param: GenerationFilterParams,
    sorters: SorterParams,
) -> List[Span]:
    """Get the spans for a given trace.

    Args:
        app_id (str): The ID of the app
        pagination (PaginationParam): The data of the pagination param
        filters_param (GenerationFilterParams): The data of the generation filter params
        sorters (SorterParams): The data of the sorters param

    Returns:
        List[Span]: the list of spans for the given user
    """

    # Apply pagination and sorting
    skip, limit = get_pagination_skip_limit(pagination)
    sort_direction = (
        pymongo.ASCENDING if sorters.created_at == "asc" else pymongo.DESCENDING
    )

    # Fetch spans without pagination and sorting applied
    base_spans_db = SpanDB.find(SpanDB.trace.app_id == app_id)

    # Count of spans in db
    filters_query = {}
    if filters_param.environment is not None:
        filters_query["environment"] = filters_param.environment
    elif filters_param.variant is not None:
        filters_query["variant_id"] = filters_param.variant
    spans_count = await base_spans_db.find(filters_query, fetch_links=True).count()

    # Fetch spans with pagination and sorting applied
    spans_db = base_spans_db.find(fetch_links=True, skip=skip, limit=limit).sort(
        [(SpanDB.created_at, sort_direction)]
    )

    # Filter based on trace_id or not
    if filters_param.trace_id is not None:
        spans_db = await spans_db.find_many(
            SpanDB.trace.id == ObjectId(filters_param.trace_id), fetch_links=True
        ).to_list()
    else:
        spans_db = await spans_db.to_list()

    # Convert beanie documents to pydantic models and filter based on the filter_params
    spans = await spans_to_pydantic(spans_db)
    filtered_generations = filter(
        partial(filters.filter_document_by_filter_params, filters_param), spans
    )
    if filters_param.trace_id:
        return list(filtered_generations)
    return get_paginated_data(list(filtered_generations), spans_count, pagination)


async def fetch_generation_span_detail(span_id: str) -> SpanDetail:
    """Get a generation span detail.

    Args:
        span_id (str): The ID of a span

    Returns:
        SpanDetail: span detail pydantic model
    """

    span_db = await SpanDB.find_one(SpanDB.id == ObjectId(span_id), fetch_links=True)
    app_variant_db = await db_manager.fetch_app_variant_by_id(span_db.trace.variant_id)

    return SpanDetail(
        **{
            "id": str(span_db.id),
            "created_at": span_db.created_at.isoformat(),
            "variant": {
                "variant_id": str(app_variant_db.id),
                "variant_name": app_variant_db.variant_name,
                "revision": app_variant_db.revision,
            },
            "environment": span_db.environment,
            "status": span_db.status.dict(),
            "metadata": {
                "cost": span_db.cost,
                "latency": span_db.get_latency(),
                "usage": span_db.tokens,
            },
            "user_id": "",
            "content": {
                "inputs": [
                    {"input_name": key, "input_value": value}
                    for key, value in span_db.input.items()
                ],
                "outputs": [span_db.output],
            },
            "config": span_db.attributes.get("model_config"),
        },
    )


async def retrieve_observability_dashboard(
    app_id: str,
    params: ObservabilityDashboardDataRequestParams,
) -> ObservabilityDashboardData:
    # Apply filtering based on the environment and variant (base_id)
    filtered_spans = filters.filter_observability_dashboard_spans_db_by_filters(
        app_id, params
    )

    # Apply datetime filter and aggregation pipeline
    spans = None
    if params.timeRange is not None:
        filter_datetime = filters.filter_by_time_range(params.timeRange)
        spans_aggregation_mapping = filters.prepares_spans_aggregation_by_timerange(
            params.timeRange
        )
        pipeline = [
            {"$match": {"created_at": {"$gte": filter_datetime}}},
            spans_aggregation_mapping,
        ]
        spans = await filtered_spans.aggregate(
            pipeline,
        ).to_list()

    observability_data: ObservabilityData = []
    for span in spans:
        observability_data.append(ObservabilityData(**span, timestamp=span["_id"]))

    if observability_data == []:
        return ObservabilityDashboardData(
        **{
            "data": [],
            "total_count": 0,
            "failure_rate": 0.0,
            "total_cost": 0.0,
            "avg_cost": 0.0,
            "avg_latency": 0.0,
            "total_tokens": 0,
            "avg_tokens": 0,
        }
    )

    full_observability_data = helpers.fill_missing_data(
        data=observability_data,
        time_range=params.timeRange,
    )
    len_of_observability_data = len(full_observability_data)
    sorted_data = sorted(full_observability_data, key=lambda x: x.timestamp)
    return ObservabilityDashboardData(
        **{
            "data": sorted_data,
            "total_count": len_of_observability_data,
            "failure_rate": round(sum(data.failure_count for data in sorted_data), 5),
            "total_cost": round(sum(data.cost for data in sorted_data), 5),
            "avg_cost": round(
                sum(data.cost for data in sorted_data) / len_of_observability_data,
                5,
            ),
            "avg_latency": round(
                sum(data.latency for data in sorted_data) / len_of_observability_data,
                5,
            ),
            "total_tokens": sum(data.total_tokens for data in sorted_data),
            "avg_tokens": sum(data.total_tokens for data in sorted_data)
            / len_of_observability_data,
        }
    )


async def fetch_traces(
    app_id: str,
    pagination: PaginationParam,
    filters_param: GenerationFilterParams,
    sorters: SorterParams,
) -> List[Trace]:
    """Get the traces for the given app_id.

    Args:
        app_id (str): The ID of the app
        pagination (PaginationParam): The data of the pagination param
        filters_param (GenerationFilterParams): The data of the generation filter params
        sorters (SorterParams): The data of the sorters param

    Returns:
        List[Trace]: the list of trace for the given app_id
    """

    # Apply pagination and sorting
    skip, limit = get_pagination_skip_limit(pagination)
    sort_direction = (
        pymongo.ASCENDING if sorters.created_at == "asc" else pymongo.DESCENDING
    )

    # Fetch traces without pagination and sorting applied
    base_traces_db = TraceDB.find(
        TraceDB.app_id == app_id,
    )

    # Count of traces in db
    filters_query = {}
    if filters_param.environment is not None:
        filters_query["environment"] = filters_param.environment
    elif filters_param.variant is not None:
        filters_query["variant_id"] = filters_param.variant
    traces_count = await base_traces_db.find(filters_query, fetch_links=True).count()

    # Fetch traces with pagination and sorting applied
    traces_db = (
        await base_traces_db.find(fetch_links=True, skip=skip, limit=limit)
        .sort([(TraceDB.created_at, sort_direction)])
        .to_list()
    )

    # Convert beanie documents to pydantic models and filter based on the filter_params
    traces = await traces_to_pydantic(traces_db)
    filtered_traces = filter(
        partial(filters.filter_document_by_filter_params, filters_param), traces
    )

    return get_paginated_data(list(filtered_traces), traces_count, pagination)


async def fetch_trace_detail(trace_id: str) -> TraceDetail:
    """Get a trace detail.

    Args:
        trace_id (str): The ID of a trace
        user_uid (str): The user ID

    Returns:
        TraceDetail: trace detail pydantic model
    """

    trace_db = await get_single_trace(trace_id)
    app_variant_db = await db_manager.fetch_app_variant_by_id(trace_db.variant_id)

    span_status = (
        SpanStatus(value=trace_db.status)
        if trace_db.status in ["INITIATED", "COMPLETED"]
        else SpanStatus(value=None, error=Error(message=trace_db.status))
    )
    return TraceDetail(
        **{
            "id": str(trace_db.id),
            "content": {
                "inputs": [
                    {"input_name": key, "input_value": value}
                    for key, value in trace_db.inputs.items()
                ],
                "outputs": trace_db.outputs,
            },
            "created_at": trace_db.created_at.isoformat(),
            "variant": {
                "variant_id": str(app_variant_db.id),
                "variant_name": app_variant_db.variant_name,
                "revision": app_variant_db.revision,
            },
            "environment": trace_db.environment,
            "status": span_status,
            "metadata": {
                "cost": trace_db.cost,
                "latency": trace_db.get_latency(),
                "usage": {"total_tokens": trace_db.token_consumption},
            },
            "user_id": "",
            "config": trace_db.config,
        },
    )


async def get_single_trace(trace_id: str) -> TraceDB:
    """Get a single trace document from database.

    Args:
        trace_id (str): The id of the trace

    Returns:
        TraceDB: the trace document
    """

    trace_db = await TraceDB.find_one(
        TraceDB.id == ObjectId(trace_id), fetch_links=True
    )
    if not trace_db:
        raise HTTPException(404, {"message": "Trace does not exist"})
    return trace_db


async def delete_spans(span_ids: List[str]):
    """Delete the span for a given span_ids.

    Args:
        span_ids (str): The ids of the span
    """

    object_ids: List[ObjectId] = [ObjectId(span_id) for span_id in span_ids]
    await SpanDB.find(In(SpanDB.id, object_ids)).delete()


async def delete_traces(trace_ids: List[str]):
    """Delete the trace for the given trace_ids

    Args:
        trace_ids (str): The ids of the trace
    """

    object_ids: List[ObjectId] = [ObjectId(trace_id) for trace_id in trace_ids]
    await TraceDB.find(In(TraceDB.id, object_ids)).delete()


async def add_feedback_to_trace(
    trace_id: str, payload: CreateFeedback, user_uid: str
) -> str:
    """Add a feedback to a trace.

    Args:
        trace_id (str): the Id of the trace
        payload (CreateFeedback): the required payload

    Returns:
        str: the feedback id
    """

    user = await db_manager.get_user(user_uid)
    feedback = FeedbackDB(
        user_id=str(user.id),
        feedback=payload.feedback,
        score=payload.score,
        created_at=datetime.now(),
    )

    trace = await TraceDB.find_one(TraceDB.id == ObjectId(trace_id), fetch_links=True)
    if trace.feedbacks is None:
        trace.feedbacks = [feedback]
    else:
        trace.feedbacks.append(feedback)

    # Update trace
    await trace.save()
    return feedback.uid


async def get_trace_feedbacks(trace_id: str, user_uid: str) -> List[Feedback]:
    """Get the feedbacks for a given trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[Feedback]: the list of feedbacks for the given trace
    """

    user = await db_manager.get_user(user_uid)

    # Get feedbacks in trace
    trace = await TraceDB.find_one(
        TraceDB.id == ObjectId(trace_id), TraceDB.user.id == user.id, fetch_links=True
    )
    feedbacks = [feedback_db_to_pydantic(feedback) for feedback in trace.feedbacks]
    return feedbacks


async def get_feedback_detail(
    trace_id: str, feedback_id: str, user_uid: str
) -> Feedback:
    """Get a single feedback.

    Args:
        trace_id (str): the Id of the trace
        feedback_id (str): the Id of the feedback

    Returns:
        Feedback: the feedback
    """

    user = await db_manager.get_user(user_uid)

    # Get trace
    trace = await TraceDB.find_one(
        TraceDB.id == ObjectId(trace_id), TraceDB.user.id == user.id, fetch_links=True
    )

    # Get feedback
    feedback = [
        feedback_db_to_pydantic(feedback)
        for feedback in trace.feedbacks
        if feedback.uid == feedback_id
    ]
    return feedback[0]


async def update_trace_feedback(
    trace_id: str, feedback_id: str, payload: UpdateFeedback, user_uid: str
) -> Feedback:
    """Update a feedback.

    Args:
        trace_id (str): the Id of the trace
        feedback_id (str): the Id of the feedback
        payload (UpdateFeedback): the required payload

    Returns:
        Feedback: the feedback
    """

    user = await db_manager.get_user(user_uid)

    # Get trace
    trace = await TraceDB.find_one(
        TraceDB.id == ObjectId(trace_id), TraceDB.user.id == user.id, fetch_links=True
    )

    # update feedback
    feedback_json = {}
    for feedback in trace.feedbacks:
        if feedback.uid == feedback_id:
            for key, value in payload.dict(exclude_none=True).items():
                setattr(feedback, key, value)
            feedback_json = feedback.dict()
            break

    # Save feedback in trace and return a copy
    await trace.save()

    # Replace key and transform into a pydantic representation
    feedback_json["feedback_id"] = feedback_json.pop("uid")
    return Feedback(**feedback_json)
