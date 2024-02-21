from typing import List

from fastapi import Request, Query, Depends

from agenta_backend.utils.common import APIRouter
from agenta_backend.services import event_db_manager
from agenta_backend.models.api.api_models import (
    WithPagination,
    SorterParams,
    PaginationParam,
)
from agenta_backend.models.api.observability_models import (
    Span,
    SpanDetail,
    CreateSpan,
    CreateFeedback,
    Feedback,
    UpdateFeedback,
    Trace,
    CreateTrace,
    UpdateTrace,
    GenerationFilterParams,
    ObservabilityDashboardData,
    ObservabilityDashboardDataRequestParams,
)


router = APIRouter()


@router.get(
    "/dashboard/",
    response_model=ObservabilityDashboardData,
    operation_id="observability_dashboard",
)
async def get_dashboard_data(
    request: Request, parameters: ObservabilityDashboardDataRequestParams = Depends()
):
    return event_db_manager.fetch_mock_observability_dashboard(parameters)


@router.post("/trace/", response_model=str, operation_id="create_trace")
async def create_trace(request: Request, payload: CreateTrace):
    trace_id = await event_db_manager.create_app_trace(payload, request.state.user_id)
    return trace_id


@router.post("/spans/", response_model=str, operation_id="create_span")
async def create_span(
    payload: CreateSpan,
    request: Request,
):
    spans_id = await event_db_manager.create_trace_span(payload)
    return spans_id


@router.get(
    "/spans/",
    response_model=WithPagination[Span],
    operation_id="get_spans_of_generation",
)
async def get_spans_of_trace(
    request: Request,
    pagination: PaginationParam = Depends(),
    filters: GenerationFilterParams = Depends(),
    sorters: SorterParams = Depends(),
):
    if filters and filters.type == "generation":
        spans = await event_db_manager.fetch_mock_generation(
            request.state.user_id,
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
        spans = await event_db_manager.fetch_mock_generation_detail(
            span_id, request.state.user_id
        )
        return spans
    return []


@router.put(
    "/traces/{trace_id}/", response_model=bool, operation_id="update_trace_status"
)
async def update_trace_status(
    trace_id: str,
    payload: UpdateTrace,
    request: Request,
):
    trace = await event_db_manager.trace_status_update(
        trace_id, payload, request.state.user_id
    )
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
