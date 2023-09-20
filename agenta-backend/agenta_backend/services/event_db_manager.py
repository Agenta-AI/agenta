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
from agenta_backend.models.db_models import TraceDB, FeedbackDB
from agenta_backend.models.db_engine import DBEngine

from odmantic import query


# Initialize database engine
engine = DBEngine(mode="default").engine()

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


async def costs_of_llm_run(trace_id: str) -> float:
    """Gets the cost of the llm run trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        float: the costs of the run
    """

    trace = await engine.find_one(TraceDB, TraceDB.id == ObjectId(trace_id))
    return trace.cost


async def tokens_of_llm_run(trace_id: str) -> int:
    """Gets the tokens of the llm run trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        int: the tokens of the run
    """

    trace = await engine.find_one(TraceDB, TraceDB.id == ObjectId(trace_id))
    return trace.token_consumption


async def latency_of_llm_run(trace_id: str) -> float:
    """Gets the latency of the llm run trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        float: the latency of the run
    """

    trace = await engine.find_one(TraceDB, TraceDB.id == ObjectId(trace_id))
    return trace.latency


async def inputs_of_llm_run(trace_id: str) -> List[TraceInputs]:
    """Gets the inputs of the llm run trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[TraceInputs]: the inputs of the llm run trace
    """

    trace = await engine.find_one(TraceDB, TraceDB.id == ObjectId(trace_id))
    return trace_inputs_to_pydantic(str(trace.id), trace.spans)


async def outputs_of_llm_run(trace_id: str) -> List[TraceOutputs]:
    """Gets the outputs of the llm run trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[TraceOutputs]: the outputs of the llm run trace
    """

    trace = await engine.find_one(TraceDB, TraceDB.id == ObjectId(trace_id))
    return trace_outputs_to_pydantic(str(trace.id), trace.spans)


async def get_traces(
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


async def get_single_trace(trace_id: str) -> Trace:
    """Get a single trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        Trace: the trace
    """
    
    trace_db = await engine.find_one(TraceDB, TraceDB.id == ObjectId(trace_id))
    return trace_db_to_pydantic(trace_db)


async def mark_trace_as_failed(trace_id: str, payload: UpdateTrace) -> bool:
    """Mark a trace as failed.

    Args:
        trace_id (str): the Id of the trace
        payload (UpdateTrace): the required payload

    Returns:
        bool: True if successful
    """

    trace = await engine.find_one(TraceDB, TraceDB.id == ObjectId(trace_id))
    trace.update(payload.dict())
    await engine.save(trace)
    return True


async def get_trace_spans(trace_id: str) -> List[Span]:
    """Get the spans for a given trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[Span]: the list of spans for the given trace
    """

    trace = await engine.find_one(TraceDB, TraceDB.id == ObjectId(trace_id))
    spans = spans_db_to_pydantic(trace.spans)
    return [span for span in spans]


async def add_feedback_to_trace(
    payload: CreateFeedback, **kwargs: dict
) -> Feedback:
    """Add a feedback to a trace.

    Args:
        payload (CreateFeedback): the required payload

    Returns:
        Feedback: the feedback
    """
    
    user = await db_manager.get_user_object(kwargs["uid"])

    feedback_dict = payload.dict()
    feedback_dict["trace_id"] = ObjectId(payload.trace_id)

    feedback = FeedbackDB(
        **feedback_dict, user_id=user.id, created_at=datetime.utcnow()
    )

    await engine.save(feedback)
    return feedback_db_to_pydantic(feedback)


async def get_trace_feedbacks(trace_id: str) -> List[Feedback]:
    """Get the feedbacks for a given trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[Feedback]: the list of feedbacks for the given trace
    """
    
    feedbacks_db = await engine.find(
        FeedbackDB, FeedbackDB.trace_id == ObjectId(trace_id)
    )
    feedbacks = [
        feedback_db_to_pydantic(feedback) for feedback in feedbacks_db
    ]
    return feedbacks


async def get_feedback_detail(feedback_id: str) -> Feedback:
    """Get a single feedback.

    Args:
        feedback_id (str): the Id of the feedback

    Returns:
        Feedback: the feedback
    """
    
    feedback = await engine.find_one(
        FeedbackDB, FeedbackDB.id == ObjectId(feedback_id)
    )
    return feedback_db_to_pydantic(feedback)


async def update_feedback(
    feedback_id: str, payload: UpdateFeedback
) -> Feedback:
    """Update a feedback.

    Args:
        feedback_id (str): the Id of the feedback
        payload (UpdateFeedback): the required payload

    Returns:
        Feedback: the feedback
    """
    
    feedback = await engine.find_one(
        FeedbackDB, FeedbackDB.id == ObjectId(feedback_id)
    )
    feedback = FeedbackDB(**payload.dict(), updated_at=datetime.utcnow())
    await engine.save(feedback)
    return feedback_db_to_pydantic(feedback)
