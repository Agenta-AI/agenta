"""Cumulative metrics for a trace that arrives in several OTLP batches.

An agent run reaches the API as two batches from two processes: the in-sandbox
harness exports invoke_agent / turn / chat, and the SDK exports the workflow
root about a second later. Each batch is computed on its own at ingest, so the
root used to end up with no cumulative cost or tokens at all - which is what the
Observability list, the analytics dashboard and evaluation run metrics read.
"""

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from oss.src.core.tracing.dtos import OTelFlatSpan, SpanType
from oss.src.core.tracing.service import TracingService
from oss.src.core.tracing.utils.trees import calculate_and_propagate_metrics_by_trace


PROJECT_ID = uuid4()
USER_ID = uuid4()
TRACE_ID = uuid4()

ROOT_ID = uuid4()
AGENT_ID = uuid4()
CHAT_A_ID = uuid4()
CHAT_B_ID = uuid4()

CHAT_A_COST = 0.012341250
CHAT_B_COST = 0.013361250
CHAT_A_TOKENS = 14571
CHAT_B_TOKENS = 17723

TOTAL_COST = CHAT_A_COST + CHAT_B_COST
TOTAL_TOKENS = CHAT_A_TOKENS + CHAT_B_TOKENS


def _span(
    *,
    span_id: UUID,
    span_name: str,
    span_type: SpanType,
    parent_id: UUID | None = None,
    cost: float = 0.0,
    tokens: int = 0,
    start_offset_s: int = 0,
) -> OTelFlatSpan:
    metrics: dict = {}

    if cost or tokens:
        metrics["costs"] = {"incremental": {"total": cost}}
        metrics["tokens"] = {"incremental": {"total": tokens}}

    return OTelFlatSpan(
        trace_id=str(TRACE_ID),
        span_id=str(span_id),
        parent_id=str(parent_id) if parent_id else None,
        span_name=span_name,
        span_type=span_type,
        start_time=datetime(2026, 1, 1, 0, 0, start_offset_s, tzinfo=timezone.utc),
        attributes={"ag": {"metrics": metrics}},
    )


def _harness_batch() -> list[OTelFlatSpan]:
    return [
        _span(
            span_id=AGENT_ID,
            parent_id=ROOT_ID,  # arrives in the SDK's batch, later
            span_name="invoke_agent",
            span_type=SpanType.AGENT,
            start_offset_s=1,
        ),
        _span(
            span_id=CHAT_A_ID,
            parent_id=AGENT_ID,
            span_name="chat model-a",
            span_type=SpanType.CHAT,
            cost=CHAT_A_COST,
            tokens=CHAT_A_TOKENS,
            start_offset_s=2,
        ),
        _span(
            span_id=CHAT_B_ID,
            parent_id=AGENT_ID,
            span_name="chat model-b",
            span_type=SpanType.CHAT,
            cost=CHAT_B_COST,
            tokens=CHAT_B_TOKENS,
            start_offset_s=3,
        ),
    ]


def _root_batch() -> list[OTelFlatSpan]:
    return [
        _span(
            span_id=ROOT_ID,
            span_name="_agent",
            span_type=SpanType.WORKFLOW,
            start_offset_s=0,
        )
    ]


class StubTracingDAO:
    """In-memory stand-in for the Postgres DAO, with the same upsert semantics."""

    def __init__(self):
        self.spans: dict[str, OTelFlatSpan] = {}
        self.fetch_calls: list[list] = []
        self.ingest_calls: list[list[str]] = []

    async def ingest(self, *, project_id, user_id, span_dtos):
        self.ingest_calls.append([span.span_name for span in span_dtos])

        for span_dto in span_dtos:
            self.spans[str(span_dto.span_id)] = span_dto

        return []

    async def fetch(self, *, project_id, trace_ids=None, span_ids=None):
        self.fetch_calls.append(trace_ids)

        return [
            span
            for span in self.spans.values()
            if trace_ids is None or span.trace_id in trace_ids
        ]


@pytest.fixture
def service() -> TracingService:
    return TracingService(tracing_dao=StubTracingDAO())


def _metrics(dao: StubTracingDAO, span_id: UUID) -> dict:
    return dao.spans[str(span_id)].attributes["ag"]["metrics"]


@pytest.mark.asyncio
async def test_root_gets_cumulative_metrics_after_the_second_batch(service):
    dao = service.tracing_dao

    await service.ingest(
        project_id=PROJECT_ID, user_id=USER_ID, span_dtos=_harness_batch()
    )

    # The root is not stored yet, so nothing can roll up onto it.
    assert str(ROOT_ID) not in dao.spans

    await service.ingest(
        project_id=PROJECT_ID, user_id=USER_ID, span_dtos=_root_batch()
    )

    root_metrics = _metrics(dao, ROOT_ID)

    assert root_metrics["costs"]["cumulative"]["total"] == pytest.approx(TOTAL_COST)
    assert root_metrics["tokens"]["cumulative"]["total"] == TOTAL_TOKENS


@pytest.mark.asyncio
async def test_intermediate_span_also_gets_cumulative_metrics(service):
    dao = service.tracing_dao

    await service.ingest(
        project_id=PROJECT_ID, user_id=USER_ID, span_dtos=_harness_batch()
    )
    await service.ingest(
        project_id=PROJECT_ID, user_id=USER_ID, span_dtos=_root_batch()
    )

    agent_metrics = _metrics(dao, AGENT_ID)

    assert agent_metrics["costs"]["cumulative"]["total"] == pytest.approx(TOTAL_COST)
    assert agent_metrics["tokens"]["cumulative"]["total"] == TOTAL_TOKENS


@pytest.mark.asyncio
async def test_batches_arriving_out_of_order_still_roll_up(service):
    """The SDK root can win the race and land before the harness spans."""
    dao = service.tracing_dao

    await service.ingest(
        project_id=PROJECT_ID, user_id=USER_ID, span_dtos=_root_batch()
    )
    await service.ingest(
        project_id=PROJECT_ID, user_id=USER_ID, span_dtos=_harness_batch()
    )

    root_metrics = _metrics(dao, ROOT_ID)

    assert root_metrics["costs"]["cumulative"]["total"] == pytest.approx(TOTAL_COST)
    assert root_metrics["tokens"]["cumulative"]["total"] == TOTAL_TOKENS


@pytest.mark.asyncio
async def test_a_complete_trace_costs_a_read_and_no_extra_write(service):
    """The common case: one batch holding the whole trace.

    `ingest_span_dtos` already computed the metrics before the worker got the
    batch, so the recompute confirms the same values and writes nothing.
    """
    dao = service.tracing_dao

    # What the OTLP request path does before publishing to the worker.
    span_dtos = calculate_and_propagate_metrics_by_trace(
        _root_batch() + _harness_batch()
    )

    await service.ingest(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        span_dtos=span_dtos,
    )

    assert len(dao.ingest_calls) == 1
    assert len(dao.fetch_calls) == 1

    root_metrics = _metrics(dao, ROOT_ID)

    assert root_metrics["costs"]["cumulative"]["total"] == pytest.approx(TOTAL_COST)


@pytest.mark.asyncio
async def test_ingest_survives_a_failing_recompute(service, monkeypatch):
    """A broken recompute must never lose the spans themselves."""
    dao = service.tracing_dao

    async def _boom(**kwargs):
        raise RuntimeError("fetch is down")

    monkeypatch.setattr(dao, "fetch", _boom)

    await service.ingest(
        project_id=PROJECT_ID, user_id=USER_ID, span_dtos=_harness_batch()
    )

    assert str(AGENT_ID) in dao.spans
