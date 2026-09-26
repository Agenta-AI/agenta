"""Recompute of trace totals over spans that arrived in separate OTLP requests."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Dict, List

import pytest

from oss.src.core.tracing.dtos import OTelFlatSpan, SpanType
from oss.src.core.tracing.utils.trees import (
    calculate_and_propagate_metrics_by_trace,
    recompute_cumulative_metrics,
)

TRACE_ID = "0f0e0d0c-0b0a-0908-0706-050403020100"
WORKFLOW_ID = "00000000-0000-0000-0000-000000000001"
AGENT_ID = "00000000-0000-0000-0000-000000000002"
TURN_ID = "00000000-0000-0000-0000-000000000003"
CHAT_A_ID = "00000000-0000-0000-0000-000000000004"
CHAT_B_ID = "00000000-0000-0000-0000-000000000005"

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _span(
    span_id: str,
    parent_id: str | None,
    span_type: SpanType,
    offset_s: int,
    *,
    tokens: Dict[str, float] | None = None,
    cost: float | None = None,
    errors: int = 0,
) -> OTelFlatSpan:
    metrics: dict = {}
    if tokens is not None:
        metrics["tokens"] = {"incremental": dict(tokens)}
    if cost is not None:
        metrics["costs"] = {"incremental": {"total": cost}}
    if errors:
        metrics["errors"] = {"incremental": errors}
    return OTelFlatSpan(
        trace_id=TRACE_ID,
        span_id=span_id,
        parent_id=parent_id,
        span_type=span_type,
        span_name=span_type.value,
        start_time=T0 + timedelta(seconds=offset_s),
        end_time=T0 + timedelta(seconds=offset_s + 1),
        attributes={"ag": {"metrics": metrics}},
    )


def _sdk_batch(*, copied_run_total: bool) -> List[OTelFlatSpan]:
    if copied_run_total:
        workflow = _span(
            WORKFLOW_ID,
            None,
            SpanType.WORKFLOW,
            0,
            tokens={"prompt": 100, "completion": 200, "total": 300},
            cost=0.03,
        )
        # The SDK agent handler marks the run total it copies onto the workflow span.
        workflow.attributes["ag"]["flags"] = {"aggregate_usage": True}
        return [workflow]
    return [_span(WORKFLOW_ID, None, SpanType.WORKFLOW, 0)]


def _runner_batch(*, errors: int = 0) -> List[OTelFlatSpan]:
    return [
        _span(AGENT_ID, WORKFLOW_ID, SpanType.AGENT, 1),
        _span(TURN_ID, AGENT_ID, SpanType.TASK, 2),
        _span(
            CHAT_A_ID,
            TURN_ID,
            SpanType.CHAT,
            3,
            tokens={"prompt": 40, "completion": 60, "total": 100},
            cost=0.01,
            errors=errors,
        ),
        _span(
            CHAT_B_ID,
            TURN_ID,
            SpanType.CHAT,
            4,
            tokens={"prompt": 60, "completion": 140, "total": 200},
            cost=0.02,
        ),
    ]


def _ingest(store: Dict[str, OTelFlatSpan], batch: List[OTelFlatSpan]) -> None:
    for span_dto in calculate_and_propagate_metrics_by_trace(batch):
        store[span_dto.span_id] = deepcopy(span_dto)


def _stored_rows(store: Dict[str, OTelFlatSpan]) -> List[OTelFlatSpan]:
    """What the DAO hands to the recompute: structure plus ag.metrics and ag.flags."""
    return [
        OTelFlatSpan(
            trace_id=span_dto.trace_id,
            span_id=span_dto.span_id,
            parent_id=span_dto.parent_id,
            span_type=span_dto.span_type,
            span_name="",
            start_time=span_dto.start_time,
            end_time=span_dto.end_time,
            attributes={
                "ag": {
                    "metrics": deepcopy(span_dto.attributes["ag"]["metrics"]),
                    "flags": deepcopy(span_dto.attributes["ag"].get("flags") or {}),
                }
            },
        )
        for span_dto in store.values()
    ]


def _recompute(store: Dict[str, OTelFlatSpan]) -> Dict[str, dict]:
    changes = recompute_cumulative_metrics(_stored_rows(store))
    for span_id, metrics in changes.items():
        for metric, value in metrics.items():
            store[span_id].attributes["ag"]["metrics"].setdefault(metric, {})[
                "cumulative"
            ] = value
    return changes


def _cumulative(span_dto: OTelFlatSpan, metric: str):
    return span_dto.attributes["ag"]["metrics"].get(metric, {}).get("cumulative")


@pytest.mark.parametrize("sdk_first", [True, False])
def test_root_totals_include_a_subtree_from_another_request(sdk_first):
    store: Dict[str, OTelFlatSpan] = {}
    batches = [_sdk_batch(copied_run_total=False), _runner_batch(errors=1)]
    for batch in batches if sdk_first else reversed(batches):
        _ingest(store, batch)

    assert _cumulative(store[WORKFLOW_ID], "costs") is None

    changes = _recompute(store)

    assert set(changes) == {WORKFLOW_ID}
    root = store[WORKFLOW_ID]
    assert _cumulative(root, "costs")["total"] == pytest.approx(0.03)
    assert _cumulative(root, "tokens") == {
        "prompt": 100,
        "completion": 200,
        "total": 300,
    }
    assert _cumulative(root, "errors") == 1


@pytest.mark.parametrize("sdk_first", [True, False])
def test_copied_run_total_on_the_workflow_span_is_not_counted_twice(sdk_first):
    store: Dict[str, OTelFlatSpan] = {}
    batches = [_sdk_batch(copied_run_total=True), _runner_batch()]
    for batch in batches if sdk_first else reversed(batches):
        _ingest(store, batch)

    _recompute(store)

    root = store[WORKFLOW_ID]
    assert _cumulative(root, "tokens")["total"] == 300
    assert _cumulative(root, "costs")["total"] == pytest.approx(0.03)


def test_recompute_is_idempotent_and_keeps_incremental_values():
    store: Dict[str, OTelFlatSpan] = {}
    _ingest(store, _runner_batch())
    _ingest(store, _sdk_batch(copied_run_total=False))
    incremental_before = {
        span_id: {
            metric: deepcopy(node.get("incremental"))
            for metric, node in span_dto.attributes["ag"]["metrics"].items()
        }
        for span_id, span_dto in store.items()
    }

    assert _recompute(store)
    assert _recompute(store) == {}

    for span_id, span_dto in store.items():
        for metric, node in span_dto.attributes["ag"]["metrics"].items():
            assert node.get("incremental") == incremental_before[span_id].get(metric)


def test_recompute_does_not_price_spans():
    chat = _span(
        CHAT_A_ID,
        None,
        SpanType.CHAT,
        0,
        tokens={"prompt": 10, "completion": 10, "total": 20},
    )

    changes = recompute_cumulative_metrics([chat])

    assert "costs" not in chat.attributes["ag"]["metrics"]
    assert changes == {
        CHAT_A_ID: {"tokens": {"prompt": 10, "completion": 10, "total": 20}}
    }


def test_recompute_of_an_empty_trace_is_a_no_op():
    assert recompute_cumulative_metrics([]) == {}


def test_recompute_removes_a_stale_cumulative_that_is_now_zero():
    workflow = _span(WORKFLOW_ID, None, SpanType.WORKFLOW, 0)
    workflow.attributes["ag"]["metrics"] = {
        "errors": {"incremental": 0, "cumulative": 2},
        "costs": {"cumulative": {"total": 0.5}},
    }

    changes = recompute_cumulative_metrics([workflow])

    # Removed, not zeroed: the dashboard counts any stored errors value as a failure.
    assert changes == {WORKFLOW_ID: {"errors": None, "costs": None}}

    cleared = _span(WORKFLOW_ID, None, SpanType.WORKFLOW, 0)
    cleared.attributes["ag"]["metrics"] = {"errors": {"incremental": 0}}
    assert recompute_cumulative_metrics([cleared]) == {}
