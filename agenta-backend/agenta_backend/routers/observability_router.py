import os
from typing import List

from fastapi import Request
from agenta_backend.utils.common import APIRouter

from agenta_backend.services.event_db_manager import (
    get_variant_traces,
    create_app_trace,
    create_trace_span,
    get_trace_single,
    trace_status_update,
    get_trace_spans,
    add_feedback_to_trace,
    get_trace_feedbacks,
    get_feedback_detail,
    update_trace_feedback,
)
from agenta_backend.models.api.observability_models import (
    Span,
    CreateSpan,
    CreateFeedback,
    Feedback,
    UpdateFeedback,
    Trace,
    CreateTrace,
    UpdateTrace,
)


router = APIRouter()


@router.post("/traces/", response_model=str, operation_id="create_trace")
async def create_trace(
    payload: CreateTrace,
    request: Request,
):
    trace = await create_app_trace(payload, request.state.user_id)
    return trace


@router.get(
    "/traces/{app_id}/{variant_id}/",
    response_model=List[Trace],
    operation_id="get_traces",
)
async def get_traces(
    app_id: str,
    variant_id: str,
    request: Request,
):
    traces = await get_variant_traces(app_id, variant_id, request.state.user_id)
    return traces


@router.get(
    "/traces/{trace_id}/", response_model=Trace, operation_id="get_single_trace"
)
async def get_single_trace(
    trace_id: str,
    request: Request,
):
    trace = await get_trace_single(trace_id, request.state.user_id)
    return trace


@router.post("/spans/", response_model=str, operation_id="create_span")
async def create_span(
    payload: CreateSpan,
    request: Request,
):
    spans_id = await create_trace_span(payload, request.state.user_id)
    return spans_id


@router.get(
    "/spans/{trace_id}/", response_model=List[Span], operation_id="get_spans_of_trace"
)
async def get_spans_of_trace(
    trace_id: str,
    request: Request,
):
    spans = await get_trace_spans(trace_id, request.state.user_id)
    return spans


@router.put(
    "/traces/{trace_id}/", response_model=bool, operation_id="update_trace_status"
)
async def update_trace_status(
    trace_id: str,
    payload: UpdateTrace,
    request: Request,
):
    trace = await trace_status_update(trace_id, payload, request.state.user_id)
    return trace


@router.post(
    "/feedbacks/{trace_id}/", response_model=str, operation_id="create_feedback"
)
async def create_feedback(
    trace_id: str,
    payload: CreateFeedback,
    request: Request,
):
    feedback = await add_feedback_to_trace(trace_id, payload, request.state.user_id)
    return feedback


@router.get(
    "/feedbacks/{trace_id}/",
    response_model=List[Feedback],
    operation_id="get_feedbacks",
)
async def get_feedbacks(trace_id: str, request: Request):
    feedbacks = await get_trace_feedbacks(trace_id, request.state.user_id)
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
    feedback = await get_feedback_detail(trace_id, feedback_id, request.state.user_id)
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
    feedback = await update_trace_feedback(trace_id, feedback_id, payload, request.state.user_id)
    return feedback
