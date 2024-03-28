from typing import List, Any

from fastapi import Request, Query, Depends

from agenta_backend.utils.common import APIRouter
from agenta_backend.services import event_db_manager, redis_cache_service
from agenta_backend.models.api.api_models import (
    WithPagination,
    SorterParams,
    PaginationParam,
)
from agenta_backend.models.api.observability_models import (
    SpanDetail,
    CreateSpan,
    CreateFeedback,
    Feedback,
    UpdateFeedback,
    TraceDetail,
    CreateTrace,
    UpdateTrace,
    GenerationFilterParams,
    ObservabilityDashboardDataRequestParams,
)


router = APIRouter()


@router.get(
    "/dashboard/",
    operation_id="observability_dashboard",
)
async def get_dashboard_data(
    request: Request,
    app_id: str,
    parameters: ObservabilityDashboardDataRequestParams = Depends(),
):
    try:
        dashboard_data = await redis_cache_service.cache_observability_data(
            event_db_manager.retrieve_observability_dashboard,
            **{
                "app_id": app_id,
                "parameters": parameters,
                "cache_key": str(request.url),
            }
        )
        return dashboard_data
    except Exception as e:
        import traceback

        traceback.print_exc()
        return []


@router.post("/traces/", response_model=str, operation_id="create_trace")
async def create_trace(request: Request, payload: CreateTrace):
    trace_id = await event_db_manager.create_app_trace(payload)
    return trace_id


@router.post("/spans/", response_model=str, operation_id="create_span")
async def create_span(
    payload: CreateSpan,
    request: Request,
):
    spans_id = await event_db_manager.create_trace_span(payload)
    return spans_id


@router.get(
    "/traces/",
    response_model=WithPagination,
    operation_id="get_traces",
)
async def get_traces(
    request: Request,
    app_id: str,
    pagination: PaginationParam = Depends(),
    filters: GenerationFilterParams = Depends(),
    sorters: SorterParams = Depends(),
):
    spans = await event_db_manager.fetch_traces(
        app_id,
        pagination,
        filters,
        sorters,
    )
    return spans


@router.get(
    "/traces/{trace_id}/",
    response_model=TraceDetail,
    operation_id="get_trace_detail",
)
async def get_trace_detail(
    request: Request,
    trace_id: str,
):
    trace_detail = await event_db_manager.fetch_trace_detail(trace_id)
    return trace_detail


@router.delete("/traces/", response_model=bool, operation_id="delete_traces")
async def delete_traces(request: Request, ids: List[str]):
    await event_db_manager.delete_traces(ids)
    return True


@router.get(
    "/spans/",
    operation_id="get_spans_of_generation",
)
async def get_spans_of_trace(
    request: Request,
    app_id: str,
    pagination: PaginationParam = Depends(),
    filters: GenerationFilterParams = Depends(),
    sorters: SorterParams = Depends(),
):
    if filters and filters.type == "generation":
        spans = await event_db_manager.fetch_generation_spans(
            app_id,
            pagination,
            filters,
            sorters,
        )
        return spans
    return []


@router.get(
    "/spans/{span_id}/",
    response_model=SpanDetail,
    operation_id="get_span_of_generation",
)
async def get_span_of_trace(
    request: Request,
    span_id: str,
    type: str = Query(default="generation"),
):
    if type == "generation":
        spans = await event_db_manager.fetch_generation_span_detail(span_id)
        return spans
    return []


@router.delete("/spans/", response_model=bool, operation_id="delete_spans_of_trace")
async def delete_spans_of_trace(request: Request, ids: List[str]):
    await event_db_manager.delete_spans(ids)
    return True


@router.put("/traces/{trace_id}/", response_model=bool, operation_id="update_trace")
async def update_trace(
    trace_id: str,
    payload: UpdateTrace,
    request: Request,
):
    trace = await event_db_manager.trace_update(trace_id, payload)
    return trace


@router.post(
    "/feedbacks/{trace_id}/", response_model=str, operation_id="create_feedback"
)
async def create_feedback(
    trace_id: str,
    payload: CreateFeedback,
    request: Request,
):
    feedback = await event_db_manager.add_feedback_to_trace(
        trace_id, payload, request.state.user_id
    )
    return feedback


@router.get(
    "/feedbacks/{trace_id}/",
    response_model=List[Feedback],
    operation_id="get_feedbacks",
)
async def get_feedbacks(trace_id: str, request: Request):
    feedbacks = await event_db_manager.get_trace_feedbacks(
        trace_id, request.state.user_id
    )
    return feedbacks


@router.get(
    "/feedbacks/{trace_id}/{feedback_id}/",
    response_model=Feedback,
    operation_id="get_feedback",
)
async def get_feedback(
    trace_id: str,
    feedback_id: str,
    request: Request,
):
    feedback = await event_db_manager.get_feedback_detail(
        trace_id, feedback_id, request.state.user_id
    )
    return feedback


@router.put(
    "/feedbacks/{trace_id}/{feedback_id}/",
    response_model=Feedback,
    operation_id="update_feedback",
)
async def update_feedback(
    trace_id: str,
    feedback_id: str,
    payload: UpdateFeedback,
    request: Request,
):
    feedback = await event_db_manager.update_trace_feedback(
        trace_id, feedback_id, payload, request.state.user_id
    )
    return feedback
