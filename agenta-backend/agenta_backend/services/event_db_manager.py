import logging
from typing import List
from bson import ObjectId
from datetime import datetime

from agenta_backend.models.api.observability_models import (
    Span,
    Feedback,
    CreateFeedback,
    UpdateFeedback,
    Trace,
    CreateTrace,
    UpdateTrace,
    TraceInputs,
    TraceOutputs,
)
from agenta_backend.models.converters import (
    spans_db_to_pydantic,
    feedback_db_to_pydantic,
    trace_db_to_pydantic,
    trace_inputs_to_pydantic,
    trace_outputs_to_pydantic,
)
from agenta_backend.services import db_manager
from agenta_backend.models.db_models import TraceDB, FeedbackDB, SpanDB
from agenta_backend.models.db_engine import DBEngine

from odmantic import query


# Initialize database engine
engine = DBEngine(mode="default").engine()

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


async def costs_of_llm_run(trace_id: str, **kwargs: dict) -> float:
    """Gets the cost of the llm run trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        float: the costs of the run
    """

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)
    return trace.cost


async def tokens_of_llm_run(trace_id: str, **kwargs: dict) -> int:
    """Gets the tokens of the llm run trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        int: the tokens of the run
    """

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)
    return trace.token_consumption


async def latency_of_llm_run(trace_id: str, **kwargs: dict) -> float:
    """Gets the latency of the llm run trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        float: the latency of the run
    """

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)
    return trace.latency


async def inputs_of_llm_run(
    trace_id: str, **kwargs: dict
) -> List[TraceInputs]:
    """Gets the inputs of the llm run trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[TraceInputs]: the inputs of the llm run trace
    """

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)
    return trace_inputs_to_pydantic(str(trace.id), trace.spans)


async def outputs_of_llm_run(
    trace_id: str, **kwargs: dict
) -> List[TraceOutputs]:
    """Gets the outputs of the llm run trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[TraceOutputs]: the outputs of the llm run trace
    """

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)
    return trace_outputs_to_pydantic(str(trace.id), trace.spans)


async def get_variant_traces(
    app_name: str, variant_name: str, **kwargs: dict
) -> List[Trace]:
    """Get the traces for a given app variant.

    Args:
        app_name (str): the app name of the variant
        variant_name (str): the name of the variant

    Returns:
        List[Trace]: the list of traces for the given app variant
    """

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = (
        query.eq(TraceDB.user, user.id)
        & query.eq(TraceDB.app_name, app_name)
        & query.eq(TraceDB.variant_name, variant_name)
    )

    traces = await engine.find(TraceDB, query_expressions)
    return [trace_db_to_pydantic(trace) for trace in traces]


async def create_app_trace(payload: CreateTrace, **kwargs: dict) -> Trace:
    """Create a new trace.

    Args:
        payload (CreateTrace): the required payload

    Returns:
        Trace: the created trace
    """

    user = await db_manager.get_user_object(kwargs["uid"])

    trace_payload_dict = payload.dict()
    spans_payload_dict = trace_payload_dict["spans"]

    del trace_payload_dict["spans"]

    spans = [SpanDB(**span_payload) for span_payload in spans_payload_dict]
    await engine.save_all(spans)

    trace = TraceDB(**trace_payload_dict, user=user, spans=spans)
    await engine.save(trace)
    return trace_db_to_pydantic(trace)


async def get_single_trace(trace_id: str, **kwargs: dict) -> Trace:
    """Get a single trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        Trace: the trace
    """

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)
    return trace_db_to_pydantic(trace)


async def update_trace_status(
    trace_id: str, payload: UpdateTrace, **kwargs: dict
) -> bool:
    """Mark a trace as failed.

    Args:
        trace_id (str): the Id of the trace
        payload (UpdateTrace): the required payload

    Returns:
        bool: True if successful
    """

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = query.eq(TraceDB.id, ObjectId(trace_id)) & query.eq(
        TraceDB.user, user.id
    )

    # Get trace
    trace = await engine.find_one(TraceDB, query_expressions)

    # Update and save trace
    trace.status = payload.status
    await engine.save(trace)
    return True


async def get_trace_spans(trace_id: str, **kwargs: dict) -> List[Span]:
    """Get the spans for a given trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[Span]: the list of spans for the given trace
    """

    user = await db_manager.get_user_object(kwargs["uid"])
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
) -> Feedback:
    """Add a feedback to a trace.

    Args:
        trace_id (str): the Id of the trace
        payload (CreateFeedback): the required payload

    Returns:
        Feedback: the feedback
    """

    user = await db_manager.get_user_object(kwargs["uid"])
    feedback = FeedbackDB(
        feedback=payload.feedback,
        user_id=user.id,
        score=payload.score,
        trace_id=ObjectId(trace_id),
        created_at=datetime.utcnow(),
    )

    await engine.save(feedback)
    return feedback_db_to_pydantic(feedback)


async def get_trace_feedbacks(trace_id: str, **kwargs: dict) -> List[Feedback]:
    """Get the feedbacks for a given trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[Feedback]: the list of feedbacks for the given trace
    """

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = query.eq(
        FeedbackDB.trace_id, ObjectId(trace_id)
    ) & query.eq(FeedbackDB.user_id, user.id)

    # Get feedbacks
    feedbacks_db = await engine.find(FeedbackDB, query_expressions)
    feedbacks = [
        feedback_db_to_pydantic(feedback) for feedback in feedbacks_db
    ]
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

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = (
        query.eq(FeedbackDB.id, ObjectId(feedback_id))
        & query.eq(FeedbackDB.trace_id, ObjectId(trace_id))
        & query.eq(FeedbackDB.user_id, user.id)
    )

    # Get feedback
    feedback = await engine.find_one(FeedbackDB, query_expressions)
    return feedback_db_to_pydantic(feedback)


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

    user = await db_manager.get_user_object(kwargs["uid"])
    query_expressions = (
        query.eq(FeedbackDB.id, ObjectId(feedback_id))
        & query.eq(FeedbackDB.trace_id, ObjectId(trace_id))
        & query.eq(FeedbackDB.user_id, user.id)
    )

    # Get feedback
    feedback = await engine.find_one(FeedbackDB, query_expressions)

    # Update feedback
    feedback.update(payload.dict())
    feedback.updated_at = updated_at = datetime.utcnow()

    # Save feedback and convert it to json
    await engine.save(feedback)
    return feedback_db_to_pydantic(feedback)
