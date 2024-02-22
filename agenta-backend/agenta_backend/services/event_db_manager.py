import logging
from typing import List
from datetime import datetime

from fastapi import HTTPException

from agenta_backend.models.api.api_models import PaginationParam, SorterParams
from agenta_backend.models.api.observability_models import (
    Span,
    SpanDetail,
    CreateSpan,
    ObservabilityDashboardData,
    Feedback,
    CreateFeedback,
    UpdateFeedback,
    Trace,
    CreateTrace,
    UpdateTrace,
    ObservabilityData,
    GenerationFilterParams,
    ObservabilityDashboardDataRequestParams,
)
from agenta_backend.models.converters import (
    spans_to_pydantic,
    feedback_db_to_pydantic,
    trace_db_to_pydantic,
    get_paginated_data,
)
from agenta_backend.services import db_manager
from agenta_backend.models.db_models import (
    TraceDB,
    Feedback as FeedbackDB,
    SpanDB,
)

from beanie import PydanticObjectId as ObjectId


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


async def get_variant_traces(
    app_id: str, variant_id: str, user_uid: str
) -> List[Trace]:
    """Get the traces for a given app variant.

    Args:
        app_id (str): the app id of the trace
        variant_id (str): the id of the variant

    Returns:
        List[Trace]: the list of traces for the given app variant
    """

    user = await db_manager.get_user(user_uid)
    traces = await TraceDB.find(
        TraceDB.user.id == user.id,
        TraceDB.app_id == app_id,
        TraceDB.variant_id == variant_id,
        fetch_links=True,
    ).to_list()
    return [trace_db_to_pydantic(trace) for trace in traces]


async def create_app_trace(payload: CreateTrace, user_uid: str) -> str:
    """Create a new trace.

    Args:
        payload (CreateTrace): the required payload

    Returns:
        Trace: the created trace
    """

    user = await db_manager.get_user(user_uid)

    # Ensure spans exists in the db
    for span in payload.spans:
        span_db = await SpanDB.find_one(SpanDB.id == ObjectId(span), fetch_links=True)
        if span_db is None:
            raise HTTPException(404, detail=f"Span {span} does not exist")

    trace_db = TraceDB(**payload.dict(), user=user)
    await trace_db.create()
    return str(trace_db.id)


async def get_trace_single(trace_id: str, user_uid: str) -> Trace:
    """Get a single trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        Trace: the trace
    """

    user = await db_manager.get_user(user_uid)

    # Get trace
    trace = await TraceDB.find_one(
        TraceDB.id == ObjectId(trace_id), TraceDB.user.id == user.id, fetch_links=True
    )
    return trace_db_to_pydantic(trace)


async def trace_status_update(
    trace_id: str, payload: UpdateTrace, user_uid: str
) -> bool:
    """Update status of trace.

    Args:
        trace_id (str): the Id of the trace
        payload (UpdateTrace): the required payload

    Returns:
        bool: True if successful
    """

    user = await db_manager.get_user(user_uid)

    # Get trace
    trace = await TraceDB.find_one(
        TraceDB.id == ObjectId(trace_id), TraceDB.user.id == user.id
    )

    # Update and save trace
    trace.status = payload.status
    await trace.save()
    return True


async def create_trace_span(payload: CreateSpan) -> str:
    """Create a new span for a given trace.

    Args:
        payload (CreateSpan): the required payload

    Returns:
        str: the created span id
    """

    span_db = SpanDB(**payload.dict())
    await span_db.create()
    return str(span_db.id)


async def get_trace_spans_by_user_uid(
    user_uid: str, trace_type: str, pagination: PaginationParam
) -> List[Span]:
    """Get the spans for a given trace.

    Args:
        user_uid (str): the uid of the user
        trace_type (str): the type of the trace

    Returns:
        List[Span]: the list of spans for the given user
    """

    user = await db_manager.get_user(user_uid)

    # Get trace
    trace = await TraceDB.find_one(
        TraceDB.type == trace_type, TraceDB.user.id == user.id, fetch_links=True
    )

    # Get trace spans
    spans = await spans_to_pydantic(trace.spans, trace)
    return get_paginated_data(spans, pagination)


async def fetch_mock_generation(
    user_uid: str,
    pagination: PaginationParam,
    filters: GenerationFilterParams,
    sorters: SorterParams,
) -> List[Span]:
    import random, uuid
    from faker import Faker
    from datetime import datetime, timedelta

    fake = Faker()
    list_of_generations = []

    user = await db_manager.get_user(user_uid)

    def get_random_timestamp():
        past_24_hours = datetime.now() - timedelta(hours=24)
        random_time = fake.date_time_between(start_date=past_24_hours)
        return random_time.isoformat()

    def generate_mock_generation():
        status_value = random.choice(["SUCCESS", "FAILURE", "INITIATED"])
        list_of_generations.append(
            Span(
                **{
                    "id": str(uuid.uuid4()),
                    "created_at": get_random_timestamp(),
                    "variant": {
                        "variant_id": str(uuid.uuid4()),
                        "variant_name": fake.company(),
                        "revision": random.randint(1, 20),
                    },
                    "environment": random.choice(
                        ["development", "staging", "production"]
                    ),
                    "status": {
                        "value": status_value,
                        "error": (
                            {
                                "message": fake.sentence(),
                                "stacktrace": fake.text(
                                    max_nb_chars=200
                                ),  # Short stacktrace
                            }
                            if status_value == "FAILURE"
                            else None
                        ),
                    },
                    "metadata": {
                        "cost": random.uniform(0.01, 2),
                        "latency": random.uniform(0.1, 10),
                        "usage": {
                            "completion_tokens": random.randint(50, 300),
                            "prompt_tokens": random.randint(20, 100),
                            "total_tokens": random.randint(100, 500),
                        },
                    },
                    "user_id": str(user.id),
                }
            )
        )

    for _ in range(10):
        generate_mock_generation()

    def filter_span(span: Span):
        if filters:
            if filters.variant and span.variant.variant_name != filters.variant:
                return False
            if filters.environment and span.environment != filters.environment:
                return False
        return True

    filtered_generations = filter(filter_span, list_of_generations)

    sort_keys = list(sorters.dict(exclude=None).keys())
    if "created_at" in sort_keys:
        reverse = sorters.created_at == "desc" if sorters else False

    sorted_generations = sorted(
        filtered_generations, key=lambda x: x.created_at, reverse=reverse
    )
    return get_paginated_data(sorted_generations, pagination)


async def fetch_mock_generation_detail(generation_id: str, user_uid: str) -> SpanDetail:
    import random, uuid
    from faker import Faker
    from datetime import datetime, timedelta

    fake = Faker()
    user = await db_manager.get_user(user_uid)

    def get_random_timestamp():
        past_24_hours = datetime.now() - timedelta(hours=24)
        random_time = fake.date_time_between(start_date=past_24_hours)
        return random_time.isoformat()

    def generate_mock_generation():
        status_value = random.choice(["SUCCESS", "FAILURE", "INITIATED"])
        return {
            "id": str(uuid.uuid4()),
            "created_at": get_random_timestamp(),
            "variant": {
                "variant_id": str(uuid.uuid4()),
                "variant_name": fake.company(),
                "revision": random.randint(1, 20),
            },
            "environment": random.choice(["development", "staging", "production"]),
            "status": {
                "value": random.choice(["INITIATED", "SUCCESS", "FAILURE"]),
                "error": (
                    {
                        "message": fake.sentence(),
                        "stacktrace": fake.text(max_nb_chars=200),  # Short stacktrace
                    }
                    if status_value == "FAILURE"
                    else None
                ),
            },
            "metadata": {
                "cost": random.uniform(0.01, 2),
                "latency": random.uniform(0.1, 10),
                "usage": {
                    "completion_tokens": random.randint(50, 300),
                    "prompt_tokens": random.randint(20, 100),
                    "total_tokens": random.randint(100, 500),
                },
            },
            "user_id": str(user.id),
        }

    return SpanDetail(
        **generate_mock_generation(),
        **{
            "span_id": generation_id,
            "content": {
                "inputs": [
                    {"input_name": fake.word(), "input_value": fake.sentence()}
                    for _ in range(random.randint(1, 3))
                ],
                "output": fake.paragraph(nb_sentences=3),
            },
            "model_params": {
                "prompt": {
                    "system": (
                        fake.sentence() if random.random() < 0.5 else None
                    ),  # Optional system prompt
                    "user": fake.sentence(),
                    "variables": [
                        {
                            "name": fake.word(),
                            "type": random.choice(["number", "string", "bool"]),
                        }
                        for _ in range(random.randint(0, 2))
                    ],
                },
                "params": {
                    "temperature": random.uniform(0.2, 0.9),
                    "top_p": random.uniform(0.5, 1.0),
                },
            },
        },
    )


def fetch_mock_observability_dashboard(
    params: ObservabilityDashboardDataRequestParams,
) -> ObservabilityDashboardData:
    import random
    from datetime import datetime

    list_of_data_points = []

    def generate_data_point():
        for _ in range(10):
            list_of_data_points.append(
                ObservabilityData(
                    **{
                        "timestamp": datetime.now(),
                        "success_count": random.randint(5, 20),
                        "failure_count": random.randint(0, 5),
                        "cost": random.uniform(0.05, 0.5),
                        "latency": random.uniform(0.2, 1.5),
                        "total_tokens": random.randint(100, 500),
                        "prompt_tokens": random.randint(20, 150),
                        "completion_tokens": random.randint(50, 300),
                        "environment": random.choice(
                            ["development", "staging", "production"]
                        ),
                        "variant": f"variant_{random.randint(1, 5)}",
                    }
                )
            )

    generate_data_point()

    def filter_data(data: ObservabilityData):
        if params:
            if params.environment and data.environment == params.environment:
                return True
            if params.variant and data.variant == params.variant:
                return True

            # Convert data.timestamp to epoch time
            epoch_time = int(data.timestamp.timestamp())
            if (params.startTime and params.endTime) and (
                epoch_time in [params.startTime, params.endTime]
            ):
                return True
            if (
                params.environment == data.environment
                and params.variant == data.variant
            ):
                return True
            if (
                (params.startTime and params.endTime)
                and (data.timestamp in [params.startTime, params.endTime])
                and (
                    params.environment == data.environment
                    and params.variant == data.variant
                )
            ):
                return True
        return False

    filtered_data = filter(filter_data, list_of_data_points)
    return ObservabilityDashboardData(
        **{
            "data": list(filtered_data),
            "total_count": random.randint(50, 200),
            "failure_rate": random.uniform(0.0, 0.25),
            "total_cost": random.uniform(5, 20),
            "avg_cost": random.uniform(0.1, 0.8),
            "avg_latency": random.uniform(0.5, 2.0),
            "total_tokens": random.randint(1000, 5000),
            "avg_tokens": random.randint(100, 500),
        }
    )


async def get_trace_spans(trace_id: str, user_uid: str) -> List[Span]:
    """Get the spans for a given trace.

    Args:
        trace_id (str): the Id of the trace

    Returns:
        List[Span]: the list of spans for the given trace
    """

    user = await db_manager.get_user(user_uid)

    # Get trace
    trace = await TraceDB.find_one(
        TraceDB.id == ObjectId(trace_id), TraceDB.user.id == user.id, fetch_links=True
    )

    # Get trace spans
    spans = spans_to_pydantic(trace.spans)
    return spans


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
