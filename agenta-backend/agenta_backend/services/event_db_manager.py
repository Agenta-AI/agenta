import logging
from typing import List
from bson import ObjectId
from datetime import datetime

from fastapi import HTTPException

from agenta_backend.models.api.observability_models import (
    Span,
    CreateSpan,
    Feedback,
    CreateFeedback,
    UpdateFeedback,
    Trace,
    CreateTrace,
    UpdateTrace,
)
from agenta_backend.models.converters import (
    spans_db_to_pydantic,
    feedback_db_to_pydantic,
    trace_db_to_pydantic,
)
from agenta_backend.services import db_manager
from agenta_backend.models.db_models import (
    TraceDB,
    Feedback as FeedbackDB,
    SpanDB,
)
from agenta_backend.models.db_engine import DBEngine

from odmantic import query


# Initialize database engine
engine = DBEngine().engine()

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


async def get_variant_traces(
    app_id: str, variant_id: str, **kwargs: dict
) -> List[Trace]:
    """Get the traces for a given app variant.

    Args:
        app_id (str): the app id of the trace
        variant_id (str): the id of the variant

    Returns:
        List[Trace]: the list of traces for the given app variant
    """

    user = await db_manager.get_user_object(user_uid=kwargs["uid"])
    query_expressions = (
        query.eq(TraceDB.user, user.id)
        & query.eq(TraceDB.app_id, app_id)
        & query.eq(TraceDB.variant_id, variant_id)
    )

    traces = await engine.find(TraceDB, query_expressions)
    return [trace_db_to_pydantic(trace) for trace in traces]


async def create_app_trace(payload: CreateTrace, **kwargs: dict) -> str:
    """Create a new trace.

    Args:
        payload (CreateTrace): the required payload

    Returns:
        Trace: the created trace
    """

    user = await db_manager.get_user_object(user_uid=kwargs["uid"])

    # Ensure spans exists in the db
    for span in payload.spans:
        span_db = await engine.find_one(SpanDB, SpanDB.id == ObjectId(span))
        if span_db is None:
            raise HTTPException(404, detail=f"Span {span} does not exist")

    trace = TraceDB(**payload.dict(), user=user)
    await engine.save(trace)
    return trace_db_to_pydantic(trace)["trace_id"]


async def get_single_trace(trace_id: str, **kwargs: dict) -> Trace:
    """Get a single trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        Trace: the trace
    """

    user = await db_manager.get_user_object(user_uid=kwargs["uid"])
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)
    return trace_db_to_pydantic(trace)


async def trace_status_update(
    trace_id: str, payload: UpdateTrace, **kwargs: dict
) -> bool:
    """Update status of trace.

    Args:
        trace_id (str): the Id of the trace
        payload (UpdateTrace): the required payload

    Returns:
        bool: True if successful
    """

    user = await db_manager.get_user_object(user_uid=kwargs["uid"])
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)

    # Update and save trace
    trace.status = payload.status
    await engine.save(trace)
    return True


async def create_trace_span(payload: CreateSpan, **kwargs: dict) -> str:
    """Create a new span for a given trace.

    Args:
        payload (CreateSpan): the required payload

    Returns:
        str: the created span id
    """

    user = await db_manager.get_user_object(user_uid=kwargs["uid"])

    span_db = SpanDB(**payload.dict())
    await engine.save(span_db)
    return str(span_db.id)


async def get_trace_spans(trace_id: str, **kwargs: dict) -> List[Span]:
    """Get the spans for a given trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[Span]: the list of spans for the given trace
    """

    user = await db_manager.get_user_object(user_uid=kwargs["uid"])
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)

    # Get trace spans
    spans = spans_db_to_pydantic(trace.spans)
    return spans


async def add_feedback_to_trace(
    trace_id: str, payload: CreateFeedback, **kwargs: dict
) -> str:
    """Add a feedback to a trace.

    Args:
        trace_id (str): the Id of the trace
        payload (CreateFeedback): the required payload

    Returns:
        str: the feedback id
    """

    user = await db_manager.get_user_object(user_uid=kwargs["uid"])
    feedback = FeedbackDB(
        user_id=str(user.id),
        feedback=payload.feedback,
        score=payload.score,
        created_at=datetime.utcnow(),
    )

    trace = await engine.find_one(TraceDB, TraceDB.id == ObjectId(trace_id))
    if trace.feedbacks is None:
        trace.feedbacks = [feedback]
    else:
        trace.feedbacks.append(feedback)

    # Update trace
    await engine.save(trace)
    return feedback.uid


async def get_trace_feedbacks(trace_id: str, **kwargs: dict) -> List[Feedback]:
    """Get the feedbacks for a given trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[Feedback]: the list of feedbacks for the given trace
    """

    user = await db_manager.get_user_object(user_uid=kwargs["uid"])

    # Build query expressions
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get feedbacks in trace
    trace = await engine.find_one(TraceDB, query_expressions)
    feedbacks = [feedback_db_to_pydantic(feedback) for feedback in trace.feedbacks]
    return feedbacks


async def get_feedback_detail(
    trace_id: str, feedback_id: str, **kwargs: dict
) -> Feedback:
    """Get a single feedback.

    Args:
        trace_id (str): the Id of the trace
        feedback_id (str): the Id of the feedback

    Returns:
        Feedback: the feedback
    """

    user = await db_manager.get_user_object(user_uid=kwargs["uid"])

    # Build query expressions
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)

    # Get feedback
    feedback = [
        feedback_db_to_pydantic(feedback)
        for feedback in trace.feedbacks
        if feedback.uid == feedback_id
    ]
    return feedback[0]


async def update_trace_feedback(
    trace_id: str, feedback_id: str, payload: UpdateFeedback, **kwargs: dict
) -> Feedback:
    """Update a feedback.

    Args:
        trace_id (str): the Id of the trace
        feedback_id (str): the Id of the feedback
        payload (UpdateFeedback): the required payload

    Returns:
        Feedback: the feedback
    """

    user = await db_manager.get_user_object(user_uid=kwargs["uid"])

    # Build query expressions
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)

    # update feedback
    feedback_json = {}
    for feedback in trace.feedbacks:
        if feedback.uid == feedback_id:
            feedback.update(payload.dict())
            feedback_json = feedback.dict()
            break

    # Save feedback in trace and return a copy
    await engine.save(trace)

    # Replace key and transform into a pydantic representation
    feedback_json["feedback_id"] = feedback_json.pop("uid")
    return Feedback(**feedback_json)
