import os
from typing import List

from fastapi import APIRouter, Request

from agenta_backend.services.event_db_manager import (
    get_variant_traces,
    create_app_trace,
    create_trace_span,
    get_single_trace,
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

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.selectors import get_user_and_org_id


router = APIRouter()


@router.post("/traces/", response_model=str)
async def create_trace(
    payload: CreateTrace,
    request: Request,
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(request.state.user_uid)
    trace = await create_app_trace(payload, **kwargs)
    return trace


@router.get("/traces/{app_id}/{variant_id}/", response_model=List[Trace])
async def get_traces(
    app_id: str,
    variant_id: str,
    request: Request,
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(request.state.user_uid)
    traces = await get_variant_traces(app_id, variant_id, **kwargs)
    return traces


@router.get("/traces/{trace_id}/", response_model=Trace)
async def get_trace(
    trace_id: str,
    request: Request,
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(request.state.user_uid)
    trace = await get_single_trace(trace_id, **kwargs)
    return trace


@router.post("/spans/", response_model=str)
async def create_span(
    payload: CreateSpan,
    request: Request,
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(request.state.user_uid)
    spans_id = await create_trace_span(payload, **kwargs)
    return spans_id


@router.get("/spans/{trace_id}/", response_model=List[Span])
async def get_spans_of_trace(
    trace_id: str,
    request: Request,
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(request.state.user_uid)
    spans = await get_trace_spans(trace_id, **kwargs)
    return spans


@router.put("/traces/{trace_id}/", response_model=bool)
async def update_trace_status(
    trace_id: str,
    payload: UpdateTrace,
    request: Request,
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(request.state.user_uid)
    trace = await trace_status_update(trace_id, payload, **kwargs)
    return trace


@router.post("/feedbacks/{trace_id}/", response_model=str)
async def create_feedback(
    trace_id: str,
    payload: CreateFeedback,
    request: Request,
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(request.state.user_uid)
    feedback = await add_feedback_to_trace(trace_id, payload, **kwargs)
    return feedback


@router.get("/feedbacks/{trace_id}/", response_model=List[Feedback])
async def get_feedbacks(trace_id: str, request: Request):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(request.state.user_uid)
    feedbacks = await get_trace_feedbacks(trace_id, **kwargs)
    return feedbacks


@router.get("/feedbacks/{trace_id}/{feedback_id}/", response_model=Feedback)
async def get_feedback(
    trace_id: str,
    feedback_id: str,
    request: Request,
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(request.state.user_uid)
    feedback = await get_feedback_detail(trace_id, feedback_id, **kwargs)
    return feedback


@router.put("/feedbacks/{trace_id}/{feedback_id}/", response_model=Feedback)
async def update_feedback(
    trace_id: str,
    feedback_id: str,
    payload: UpdateFeedback,
    request: Request,
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(request.state.user_uid)
    feedback = await update_trace_feedback(trace_id, feedback_id, payload, **kwargs)
    return feedback
