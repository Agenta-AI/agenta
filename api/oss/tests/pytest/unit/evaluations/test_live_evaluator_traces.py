# ruff: noqa: E402

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Dict, List, Tuple
from uuid import uuid4
import sys
import types

import pytest

sys.modules.setdefault("genson", types.SimpleNamespace(SchemaBuilder=object))

from agenta.sdk.evaluations.runtime.models import PlannedCell
from agenta.sdk.evaluations.runtime.processor import _upstream_for_cell
from agenta.sdk.models.tracing import OTelLink, SpansNode, Trace

from oss.src.core.evaluations.runtime.sources import SourceResolution
from oss.src.core.evaluations.tasks.processor import _seed_context_from_source
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunFlags,
    EvaluationStatus,
)
from oss.src.core.shared.dtos import Reference
from oss.src.core.tracing.dtos import (
    ComparisonOperator,
    Condition,
    Filtering,
    LogicalOperator,
    OTelFlatSpan,
    SpanType,
    TraceType,
)
from oss.src.core.tracing.utils.trees import infer_and_propagate_trace_type_by_trace
from oss.tests.pytest.utils.principals import any_principal


class _TraceStore:
    """The traces of one project with their stored type.

    `query_traces` applies only the `trace_type` condition of the live query,
    which is the condition that keeps evaluator traces out of the next tick.
    """

    def __init__(self):
        self.traces: List[Tuple[TraceType, Trace]] = []

    def add(self, trace_type: TraceType, trace: Trace) -> None:
        self.traces.append((trace_type, trace))

    async def query_traces(self, *, project_id, query):
        wanted = [
            condition.value
            for condition in query.filtering.conditions
            if isinstance(condition, Condition) and condition.field == "trace_type"
        ]
        return [
            trace
            for trace_type, trace in self.traces
            if not wanted or trace_type.value in wanted
        ]


def _live_run(query_revision_id) -> EvaluationRun:
    return EvaluationRun(
        id=uuid4(),
        principal=any_principal(),
        flags=EvaluationRunFlags(is_live=True, has_queries=True),
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="query-live",
                    type="input",
                    origin="custom",
                    references={"query_revision": Reference(id=query_revision_id)},
                ),
            ],
            repeats=1,
        ),
    )


def _sources(store: _TraceStore, query_revision_id) -> SourceResolution:
    async def fetch_query_revision(**_kwargs):
        return SimpleNamespace(
            id=query_revision_id,
            slug="query-live",
            data=SimpleNamespace(
                filtering=Filtering(
                    operator=LogicalOperator.AND,
                    conditions=[
                        Condition(
                            field="trace_type",
                            operator=ComparisonOperator.IS,
                            value=TraceType.INVOCATION.value,
                        )
                    ],
                ),
                windowing=None,
            ),
        )

    return SourceResolution(
        queries_service=SimpleNamespace(fetch_query_revision=fetch_query_revision),
        tracing_service=store,
    )


def _evaluator_trace_type(item) -> TraceType:
    """The type the API gives the evaluator trace that runs on this source item.

    The worker seeds the evaluator context from the item, the SDK builds the
    evaluator links from that context, and ingestion types the trace from them.
    """
    context = _seed_context_from_source(source_item=item, repeats=1)
    cell = PlannedCell(
        run_id=uuid4(),
        scenario_id=uuid4(),
        step_key="evaluator",
        repeat_idx=0,
        step_type="annotation",
        step_origin="auto",
        status=EvaluationStatus.PENDING,
    )
    links: Dict = _upstream_for_cell(cell=cell, context_by_repeat=context)["links"]
    span = OTelFlatSpan(
        trace_id=uuid4().hex,
        span_id=uuid4().hex[:16],
        span_name="auto_custom_code_run_v0",
        span_type=SpanType.TASK,
        start_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
        links=(
            [
                OTelLink(
                    trace_id=link["trace_id"],
                    span_id=link["span_id"],
                    attributes={"key": key},
                )
                for key, link in links.items()
            ]
            if links
            else None
        ),
        attributes={},
    )
    [typed] = infer_and_propagate_trace_type_by_trace([span])
    return typed.trace_type


def _trace(trace_id: str, *, span_id=None) -> Trace:
    spans = (
        {
            "root": SpansNode(
                trace_id=trace_id,
                span_id=span_id,
                attributes={"ag": {"data": {"outputs": "Lima"}}},
            )
        }
        if span_id
        else {}
    )
    return Trace(trace_id=trace_id, spans=spans)


@pytest.mark.asyncio
async def test_live_query_skips_a_trace_with_no_root_span_id():
    store = _TraceStore()
    store.add(TraceType.INVOCATION, _trace("c" * 32))
    query_revision_id = uuid4()

    items = await _sources(store, query_revision_id).resolve_query_source_items(
        project_id=uuid4(),
        run=_live_run(query_revision_id),
    )

    assert items == {"query-live": []}


@pytest.mark.asyncio
async def test_next_live_tick_skips_the_evaluator_traces_of_the_last_tick():
    """Every evaluator trace a live tick produces is typed `annotation`, so the
    next tick's `trace_type is invocation` query does not read it back."""
    store = _TraceStore()
    linked_trace_id = "a" * 32
    store.add(TraceType.INVOCATION, _trace(linked_trace_id, span_id="b" * 16))
    store.add(TraceType.INVOCATION, _trace("c" * 32))
    query_revision_id = uuid4()
    sources = _sources(store, query_revision_id)
    run = _live_run(query_revision_id)

    first = await sources.resolve_query_source_items(project_id=uuid4(), run=run)
    for item in first["query-live"]:
        store.add(_evaluator_trace_type(item), _trace(uuid4().hex, span_id="d" * 16))

    second = await sources.resolve_query_source_items(project_id=uuid4(), run=run)
    assert [item.trace_id for item in second["query-live"]] == [linked_trace_id]
