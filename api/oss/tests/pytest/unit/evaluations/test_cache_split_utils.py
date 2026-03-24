from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.evaluations.utils import (
    build_repeat_indices,
    effective_is_split,
    fetch_traces_by_hash,
    make_hash,
    plan_missing_traces,
    required_traces_for_step,
    select_traces_for_reuse,
)
from oss.src.core.shared.dtos import Reference
from oss.src.core.tracing.dtos import Fields, ListOperator


def test_make_hash_normalizes_reference_objects_and_ignores_extra_fields():
    testcase_id = uuid4()
    trace_id = str(uuid4())
    span_id = str(uuid4())

    object_hash = make_hash(
        references={
            "testcase": Reference(
                id=testcase_id,
                slug="case-a",
                version="2025-03-24",
            )
        },
        links={
            "application": {
                "trace_id": trace_id,
                "span_id": span_id,
                "ignored": "value",
            }
        },
    )
    dict_hash = make_hash(
        references={
            "testcase": {
                "id": str(testcase_id),
                "slug": "case-a",
                "version": "2025-03-24",
                "ignored": "value",
            }
        },
        links={
            "application": {
                "trace_id": trace_id,
                "span_id": span_id,
            }
        },
    )

    assert object_hash is not None
    assert object_hash == dict_hash


def test_repeat_and_fanout_planning_helpers_follow_split_rules():
    assert build_repeat_indices(None) == [0]
    assert build_repeat_indices(3) == [0, 1, 2]

    assert (
        required_traces_for_step(
            repeats=3,
            is_split=True,
            step_kind="application",
            has_evaluator_steps=True,
        )
        == 3
    )
    assert (
        required_traces_for_step(
            repeats=3,
            is_split=False,
            step_kind="application",
            has_evaluator_steps=True,
        )
        == 1
    )
    assert (
        required_traces_for_step(
            repeats=3,
            is_split=False,
            step_kind="evaluator",
            has_evaluator_steps=True,
        )
        == 3
    )

    assert (
        effective_is_split(
            is_split=True,
            has_application_steps=True,
            has_evaluator_steps=True,
        )
        is True
    )
    assert (
        effective_is_split(
            is_split=True,
            is_live=True,
            has_application_steps=True,
            has_evaluator_steps=True,
        )
        is False
    )
    assert (
        effective_is_split(
            is_split=True,
            is_queue=True,
            has_application_steps=True,
            has_evaluator_steps=True,
        )
        is False
    )


def test_reuse_selection_and_missing_count_are_cardinality_based():
    traces = [SimpleNamespace(trace_id=f"trace-{idx}") for idx in range(3)]

    reusable = select_traces_for_reuse(
        traces=traces,
        required_count=2,
    )

    assert [trace.trace_id for trace in reusable] == ["trace-0", "trace-1"]
    assert plan_missing_traces(required_count=3, reusable_count=len(reusable)) == 1
    assert plan_missing_traces(required_count=1, reusable_count=2) == 0


@pytest.mark.asyncio
async def test_fetch_traces_by_hash_wrapper_delegates_to_tracing_service():
    expected_traces = [SimpleNamespace(trace_id="trace-1")]

    class DummyTracingService:
        async def query_traces(self, *, project_id, query):
            assert project_id == uuid_project_id
            assert query.windowing is not None
            assert query.windowing.limit == 2
            assert query.windowing.order == "descending"
            assert query.filtering is not None
            assert len(query.filtering.conditions) == 2
            hash_condition = query.filtering.conditions[1]
            assert hash_condition.field == Fields.HASHES
            assert hash_condition.operator == ListOperator.IN
            assert hash_condition.value == [{"id": "hash-1"}]
            return expected_traces

    uuid_project_id = uuid4()

    traces = await fetch_traces_by_hash(
        DummyTracingService(),
        uuid_project_id,
        hash_id="hash-1",
        limit=2,
    )

    assert traces == expected_traces
