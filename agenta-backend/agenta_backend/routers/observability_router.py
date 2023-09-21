import os
from typing import List

from fastapi import APIRouter, Depends

from agenta_backend.services.event_db_manager import (
    costs_of_llm_run,
    tokens_of_llm_run,
    latency_of_llm_run,
    inputs_of_llm_run,
    outputs_of_llm_run,
    get_variant_traces,
    create_app_trace,
    get_single_trace,
    update_trace_status,
    get_trace_spans,
    add_feedback_to_trace,
    get_trace_feedbacks,
    get_feedback_detail,
    update_trace_feedback,
)
from agenta_backend.models.api.observability_models import (
    Span,
    CreateFeedback,
    Feedback,
    UpdateFeedback,
    Trace,
    CreateTrace,
    UpdateTrace,
    TraceInputs,
    TraceOutputs,
)

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.ee.services.selectors import get_user_and_org_id
else:
    from agenta_backend.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.services.selectors import get_user_and_org_id


router = APIRouter()


@router.post("/traces/", response_model=Trace)
async def create_trace(
    payload: CreateTrace,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    trace = await create_app_trace(payload, **kwargs)
    return trace


@router.get("/traces/{app_name}/{variant_name}/", response_model=List[Trace])
async def get_traces(
    app_name: str,
    variant_name: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    traces = await get_variant_traces(app_name, variant_name, **kwargs)
    return traces


@router.get("/traces/{trace_id}/", response_model=Trace)
async def get_trace(
    trace_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    trace = await get_single_trace(trace_id, **kwargs)
    return trace


@router.get("/spans/{trace_id}/", response_model=List[Span])
async def get_spans_of_trace(
    trace_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    spans = await get_trace_spans(trace_id, **kwargs)
    print("Spans: ", spans)
    return spans


@router.get("/costs/{trace_id}/", response_model=float)
async def get_costs_of_trace(
    trace_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    costs = await costs_of_llm_run(trace_id, **kwargs)
    return costs


@router.get("/tokens/{trace_id}/", response_model=int)
async def get_tokens_of_trace(
    trace_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    tokens = await tokens_of_llm_run(trace_id, **kwargs)
    return tokens


@router.get("/latency/{trace_id}/", response_model=float)
async def get_latency_of_trace(
    trace_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    latency = await latency_of_llm_run(trace_id, **kwargs)
    return latency


@router.get("/inputs/{trace_id}/", response_model=TraceInputs)
async def get_trace_inputs(
    trace_id: str, stoken_session: SessionContainer = Depends(verify_session())
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    inputs = await inputs_of_llm_run(trace_id, **kwargs)
    return inputs


@router.get("/outputs/{trace_id}/", response_model=TraceOutputs)
async def get_trace_outputs(
    trace_id: str, stoken_session: SessionContainer = Depends(verify_session())
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    outputs = await outputs_of_llm_run(trace_id, **kwargs)
    return outputs


@router.put("/traces/{trace_id}/", response_model=bool)
async def update_trace(
    trace_id: str,
    payload: UpdateTrace,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    trace = await update_trace_status(trace_id, payload, **kwargs)
    return trace


@router.post("/feedbacks/{trace_id}/", response_model=Feedback)
async def create_feedback(
    trace_id: str,
    payload: CreateFeedback,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    feedback = await add_feedback_to_trace(trace_id, payload, **kwargs)
    return feedback


@router.get("/feedbacks/{trace_id}/", response_model=List[Feedback])
async def get_feedbacks(
    trace_id: str, stoken_session: SessionContainer = Depends(verify_session())
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    feedbacks = await get_trace_feedbacks(trace_id, **kwargs)
    return feedbacks


@router.get("/feedbacks/{trace_id}/{feedback_id}/", response_model=Feedback)
async def get_feedback(
    trace_id: str,
    feedback_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    feedback = await get_feedback_detail(trace_id, feedback_id, **kwargs)
    return feedback


@router.put("/feedbacks/{trace_id}/{feedback_id}/", response_model=Feedback)
async def update_feedback(
    trace_id: str,
    feedback_id: str,
    payload: UpdateFeedback,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    feedback = await update_trace_feedback(trace_id, feedback_id, payload, **kwargs)
    return feedback
