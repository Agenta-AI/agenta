from copy import deepcopy
from datetime import datetime, timezone
from uuid import UUID

import pytest

from agenta.sdk.models.tracing import OTelLink
from oss.src.core.shared.dtos import Trace
from oss.src.core.tracing.dtos import OTelFlatSpan, OTelSpan, SpanType, TraceType
from oss.src.core.tracing.utils.trees import (
    calculate_and_propagate_metrics,
    calculate_costs,
    connect_children,
    cumulate_costs,
    cumulate_errors,
    cumulate_tokens,
    get_span_from_trace,
    infer_and_propagate_trace_type_by_trace,
    parse_span_dtos_to_span_idx,
    parse_span_idx_to_span_id_tree,
    trace_map_to_traces,
    traces_to_trace_map,
)


TRACE_UUID = "31d6cfe0-4b90-11ec-8001-42010a8000b0"
ROOT_UUID = "31d6cfe0-4b90-11ec-31d6-cfe04b9011ec"
CHILD_A_UUID = "41d6cfe0-4b90-11ec-41d6-cfe04b9011ec"
CHILD_B_UUID = "51d6cfe0-4b90-11ec-51d6-cfe04b9011ec"


def _span(
    *,
    span_id: str,
    parent_id: str | None = None,
    span_name: str,
    trace_id: str = TRACE_UUID,
    links=None,
    prompt_tokens: float = 0.0,
    completion_tokens: float = 0.0,
    prompt_cost: float = 0.0,
    completion_cost: float = 0.0,
    errors: int = 0,
    start_offset_s: int = 0,
    span_type: SpanType = SpanType.TASK,
) -> OTelFlatSpan:
    total_tokens = prompt_tokens + completion_tokens
    total_cost = prompt_cost + completion_cost
    metrics = {
        "tokens": {
            "incremental": {
                "prompt": prompt_tokens,
                "completion": completion_tokens,
                "total": total_tokens,
            }
        },
        "costs": {
            "incremental": {
                "prompt": prompt_cost,
                "completion": completion_cost,
                "total": total_cost,
            }
        },
    }
    if errors:
        metrics["errors"] = {"incremental": errors}

    return OTelFlatSpan(
        trace_id=trace_id,
        span_id=span_id,
        parent_id=parent_id,
        span_name=span_name,
        span_type=span_type,
        start_time=datetime(2024, 1, 1, 0, 0, start_offset_s, tzinfo=timezone.utc),
        links=links,
        attributes={
            "ag": {
                "data": {"parameters": {"model": "gpt-4o-mini"}},
                "meta": {"response": {"model": "gpt-4o-mini"}},
                "metrics": metrics,
            }
        },
    )


def _otel_span_from_flat(span: OTelFlatSpan) -> OTelSpan:
    return OTelSpan(**span.model_dump(mode="json"))


def test_parse_span_dtos_to_span_idx_and_tree_hierarchy():
    root = _span(span_id=ROOT_UUID, span_name="root", start_offset_s=0)
    child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="child",
        start_offset_s=1,
    )

    span_idx = parse_span_dtos_to_span_idx([child, root])
    tree = parse_span_idx_to_span_id_tree(span_idx)

    assert set(span_idx.keys()) == {ROOT_UUID, CHILD_A_UUID}
    assert list(tree.keys()) == [ROOT_UUID]
    assert list(tree[ROOT_UUID].keys()) == [CHILD_A_UUID]


def test_cumulate_tokens_and_costs_propagate_from_children_to_parent():
    root = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=1,
        completion_tokens=2,
        prompt_cost=0.1,
        completion_cost=0.2,
    )
    child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="child",
        prompt_tokens=4,
        completion_tokens=5,
        prompt_cost=0.4,
        completion_cost=0.5,
        start_offset_s=1,
    )

    span_idx = parse_span_dtos_to_span_idx([root, child])
    tree = parse_span_idx_to_span_id_tree(span_idx)

    cumulate_tokens(tree, span_idx)
    cumulate_costs(tree, span_idx)

    root_tokens = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["tokens"][
        "cumulative"
    ]
    root_costs = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]["cumulative"]

    assert root_tokens == {"prompt": 5.0, "completion": 7.0, "total": 12.0}
    assert root_costs["prompt"] == pytest.approx(0.5)
    assert root_costs["completion"] == pytest.approx(0.7)
    assert root_costs["total"] == pytest.approx(1.2)


def test_cumulate_errors_propagates_scalar_counts_from_children_to_parent():
    root = _span(
        span_id=ROOT_UUID,
        span_name="root",
        errors=1,
    )
    child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="child",
        errors=2,
        start_offset_s=1,
    )

    span_idx = parse_span_dtos_to_span_idx([root, child])
    tree = parse_span_idx_to_span_id_tree(span_idx)

    cumulate_errors(tree, span_idx)

    root_errors = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["errors"]
    child_errors = span_idx[CHILD_A_UUID].attributes["ag"]["metrics"]["errors"]

    assert root_errors["incremental"] == 1
    assert root_errors["cumulative"] == 3
    assert child_errors["incremental"] == 2
    assert child_errors["cumulative"] == 2


def test_connect_children_groups_duplicate_child_names_into_lists():
    root = _otel_span_from_flat(_span(span_id=ROOT_UUID, span_name="root"))
    child_a = _otel_span_from_flat(
        _span(
            span_id=CHILD_A_UUID,
            parent_id=ROOT_UUID,
            span_name="child",
            start_offset_s=1,
        )
    )
    child_b = _otel_span_from_flat(
        _span(
            span_id=CHILD_B_UUID,
            parent_id=ROOT_UUID,
            span_name="child",
            start_offset_s=2,
        )
    )

    spans_idx = {ROOT_UUID: root, CHILD_A_UUID: child_a, CHILD_B_UUID: child_b}
    tree = parse_span_idx_to_span_id_tree(spans_idx)

    connect_children(tree, spans_idx)

    assert root.spans is not None
    assert isinstance(root.spans["child"], list)
    assert len(root.spans["child"]) == 2


def test_calculate_costs_sets_incremental_values_for_cost_supported_types(monkeypatch):
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=10,
        completion_tokens=20,
        span_type=SpanType.CHAT,
    )
    span_idx = {span.span_id: span}

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        lambda **_: (0.12, 0.34),
    )

    calculate_costs(span_idx)

    costs = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]["incremental"]
    assert costs == {"prompt": 0.12, "completion": 0.34, "total": 0.46}


def test_calculate_costs_swallows_calculation_errors(monkeypatch):
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=10,
        completion_tokens=20,
        span_type=SpanType.CHAT,
    )
    span_idx = {span.span_id: span}

    def _raise(**_):
        raise RuntimeError("boom")

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _raise,
    )

    calculate_costs(span_idx)

    assert "incremental" in span_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]


def test_calculate_and_propagate_metrics_runs_full_pipeline(monkeypatch):
    root = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=1,
        completion_tokens=1,
        span_type=SpanType.CHAT,
    )
    child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="child",
        prompt_tokens=2,
        completion_tokens=3,
        errors=1,
        span_type=SpanType.CHAT,
        start_offset_s=1,
    )

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        lambda model, prompt_tokens, completion_tokens: (
            prompt_tokens * 0.01,
            completion_tokens * 0.02,
        ),
    )

    out = calculate_and_propagate_metrics([deepcopy(root), deepcopy(child)])
    out_idx = {span.span_id: span for span in out}

    root_tokens = out_idx[ROOT_UUID].attributes["ag"]["metrics"]["tokens"]["cumulative"]
    root_costs = out_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]["cumulative"]
    root_errors = out_idx[ROOT_UUID].attributes["ag"]["metrics"]["errors"]["cumulative"]

    assert root_tokens["total"] == 7
    assert round(root_costs["total"], 6) == round(
        (1 * 0.01 + 1 * 0.02) + (2 * 0.01 + 3 * 0.02), 6
    )
    assert root_errors == 1


def test_infer_and_propagate_trace_type_by_trace_preserves_input_order():
    trace_a = "trace-a"
    trace_b = "trace-b"
    spans = [
        _span(span_id="span-a1", span_name="a1", trace_id=trace_a, start_offset_s=0),
        _span(
            span_id="span-b1",
            span_name="b1",
            trace_id=trace_b,
            start_offset_s=1,
            links=[OTelLink(trace_id=trace_a, span_id="span-a1")],
        ),
        _span(span_id="span-a2", span_name="a2", trace_id=trace_a, start_offset_s=2),
        _span(span_id="span-b2", span_name="b2", trace_id=trace_b, start_offset_s=3),
    ]

    out = infer_and_propagate_trace_type_by_trace(spans)

    assert [span.span_id for span in out] == [
        "span-a1",
        "span-b1",
        "span-a2",
        "span-b2",
    ]
    assert out[0].trace_type == TraceType.INVOCATION
    assert out[1].trace_type == TraceType.ANNOTATION
    assert out[2].trace_type == TraceType.INVOCATION
    assert out[3].trace_type == TraceType.ANNOTATION
    assert out[0].attributes["ag"]["type"]["trace"] == TraceType.INVOCATION.value
    assert out[1].attributes["ag"]["type"]["trace"] == TraceType.ANNOTATION.value


def test_trace_map_to_traces_and_back_and_get_span_helpers():
    root = _otel_span_from_flat(_span(span_id=ROOT_UUID, span_name="root"))
    child = _otel_span_from_flat(
        _span(
            span_id=CHILD_A_UUID,
            parent_id=ROOT_UUID,
            span_name="child",
            start_offset_s=1,
        )
    )

    trace_map = {TRACE_UUID: {"spans": {"root": root, "children": [child]}}}

    traces = trace_map_to_traces(trace_map)
    assert len(traces) == 1
    assert traces[0].trace_id == TRACE_UUID

    rebuilt = traces_to_trace_map(traces)
    assert TRACE_UUID in rebuilt

    trace = Trace(trace_id=TRACE_UUID, spans={"root": root, "children": [child]})
    assert get_span_from_trace(trace, ROOT_UUID) is not None
    assert get_span_from_trace(trace, CHILD_A_UUID) is not None
    assert get_span_from_trace(trace, str(UUID(int=1))) is None
