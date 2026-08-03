"""Ingest-path tests for a producer-reported agent run cost.

An agent harness reports what the run actually cost as `gen_ai.usage.cost`. The
platform never priced agent runs itself (its litellm recompute is keyed on
`ag.meta.response.model`, which agent spans do not carry), so the trace showed no
cost at all. These tests exercise the real ingest sequence — adapters first, then
the tree roll-up — and pin how the two interact:

    router.otlp_ingest -> parse_from_otel_span_dto (adapters)   [router.py:189]
    router.otlp_ingest -> TracingService.ingest_span_dtos       [router.py:256]
                       -> calculate_and_propagate_metrics_by_trace [service.py:147]
"""

from datetime import datetime, timedelta, timezone

import pytest

from oss.src.apis.fastapi.otlp.utils.processing import parse_from_otel_span_dto
from oss.src.core.otel.dtos import (
    OTelContextDTO,
    OTelSpanDTO,
    OTelSpanKind,
    OTelStatusCode,
)
from oss.src.core.tracing.utils.trees import calculate_and_propagate_metrics_by_trace


TRACE_ID = "a" * 32
ROOT_SPAN_ID = "b" * 16
AGENT_SPAN_ID = "c" * 16
MODEL_SPAN_ID = "d" * 16

START = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _otel_span(
    *,
    span_id: str,
    span_name: str,
    attributes: dict,
    parent_id: str = None,
    start_offset_s: int = 0,
) -> OTelSpanDTO:
    start = START + timedelta(seconds=start_offset_s)

    return OTelSpanDTO(
        context=OTelContextDTO(trace_id=f"0x{TRACE_ID}", span_id=f"0x{span_id}"),
        parent=(
            OTelContextDTO(trace_id=f"0x{TRACE_ID}", span_id=f"0x{parent_id}")
            if parent_id
            else None
        ),
        name=span_name,
        kind=OTelSpanKind.SPAN_KIND_INTERNAL,
        start_time=start,
        end_time=start + timedelta(seconds=1),
        status_code=OTelStatusCode.STATUS_CODE_OK,
        attributes=attributes,
    )


def _ingest(otel_spans):
    """Run the ingest sequence: adapters + builder, then the metric roll-up."""
    span_dtos = [parse_from_otel_span_dto(otel_span) for otel_span in otel_spans]

    return {
        span_dto.span_name: span_dto
        for span_dto in calculate_and_propagate_metrics_by_trace(span_dtos)
    }


def _cumulative_costs(span_dto) -> dict:
    return (
        (span_dto.attributes or {})
        .get("ag", {})
        .get("metrics", {})
        .get("costs", {})
        .get("cumulative", {})
    )


def _agent_span(**overrides) -> OTelSpanDTO:
    attributes = {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.usage.cost": 0.4237,
    }
    attributes.update(overrides.pop("attributes", {}))

    return _otel_span(
        span_id=AGENT_SPAN_ID,
        span_name="invoke_agent",
        attributes=attributes,
        **overrides,
    )


def _unpriceable_model_span(**overrides) -> OTelSpanDTO:
    # The agent runner reports the request model but not the response model, which is
    # the key the litellm recompute needs. This is what every agent chat span looks
    # like today, and why the recompute produces nothing.
    return _otel_span(
        span_id=MODEL_SPAN_ID,
        span_name="chat",
        attributes={
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-4o-mini",
            "gen_ai.usage.input_tokens": 1000,
            "gen_ai.usage.output_tokens": 100,
        },
        **overrides,
    )


def _priceable_model_span(**overrides) -> OTelSpanDTO:
    return _otel_span(
        span_id=MODEL_SPAN_ID,
        span_name="chat",
        attributes={
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-4o-mini",
            "gen_ai.response.model": "gpt-4o-mini",
            "gen_ai.usage.input_tokens": 1000,
            "gen_ai.usage.output_tokens": 100,
        },
        **overrides,
    )


@pytest.fixture
def fixed_token_pricing(monkeypatch):
    """Price every model span at a flat, tiny amount, independent of litellm's catalog."""

    def _cost_per_token(*, model, prompt_tokens, completion_tokens, **_kwargs):
        if not model:
            raise ValueError("model is required")
        return (0.00015, 0.00006)

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _cost_per_token,
    )


def test_reported_cost_becomes_cumulative_total_after_ingest():
    span_idx = _ingest([_agent_span()])

    agent_span = span_idx["invoke_agent"]

    assert _cumulative_costs(agent_span)["total"] == 0.4237


def test_reported_cost_survives_rollup_when_no_model_span_is_priceable(
    fixed_token_pricing,
):
    # The roll-up writes `cumulative` only when it computes a non-zero total, so an
    # agent run whose model spans price to nothing must keep the reported figure.
    span_idx = _ingest(
        [
            _agent_span(),
            _unpriceable_model_span(parent_id=AGENT_SPAN_ID, start_offset_s=1),
        ]
    )

    agent_span = span_idx["invoke_agent"]
    model_span = span_idx["chat"]

    assert _cumulative_costs(agent_span)["total"] == 0.4237
    assert _cumulative_costs(model_span) == {}


def test_reported_cost_wins_over_recomputed_child_costs(fixed_token_pricing):
    # Both figures describe the same spend. The reported one is what the harness was
    # billed; the recomputed one re-derives it from token counts and undercounts
    # (cached prompt tokens are priced as fresh ones). Summing children over the
    # reporting span would replace the billed figure with the lossier estimate.
    span_idx = _ingest(
        [
            _agent_span(),
            _priceable_model_span(parent_id=AGENT_SPAN_ID, start_offset_s=1),
        ]
    )

    agent_span = span_idx["invoke_agent"]
    model_span = span_idx["chat"]

    assert _cumulative_costs(agent_span)["total"] == 0.4237
    assert _cumulative_costs(model_span)["total"] == pytest.approx(0.00021)


def test_reported_cost_propagates_to_an_ancestor_that_reports_nothing(
    fixed_token_pricing,
):
    # The SDK's workflow root does not always report a cost; it must still show the
    # agent subtree's, which is what the trace list and playground read.
    root = _otel_span(
        span_id=ROOT_SPAN_ID,
        span_name="workflow",
        attributes={"ag.type.node": "workflow"},
    )
    span_idx = _ingest(
        [
            root,
            _agent_span(parent_id=ROOT_SPAN_ID, start_offset_s=1),
            _unpriceable_model_span(parent_id=AGENT_SPAN_ID, start_offset_s=2),
        ]
    )

    root_span = span_idx["workflow"]
    agent_span = span_idx["invoke_agent"]

    assert _cumulative_costs(root_span)["total"] == 0.4237
    assert _cumulative_costs(agent_span)["total"] == 0.4237


def test_reported_cost_is_not_double_counted_when_parent_and_child_both_report():
    # The SDK stamps the run total on the workflow root and the runner stamps the same
    # total on its own agent span. The reported value lands on `cumulative`, never on
    # `incremental`, so the roll-up has nothing to add it to.
    span_idx = _ingest(
        [
            _otel_span(
                span_id=ROOT_SPAN_ID,
                span_name="workflow",
                attributes={"gen_ai.usage.cost": 0.4237},
            ),
            _agent_span(parent_id=ROOT_SPAN_ID, start_offset_s=1),
        ]
    )

    root_span = span_idx["workflow"]

    assert _cumulative_costs(root_span)["total"] == 0.4237


def test_rollup_still_owns_cost_for_traces_that_report_nothing(fixed_token_pricing):
    # Guard on the change to the roll-up: spans that carry no reported cumulative must
    # keep summing their children exactly as before.
    span_idx = _ingest(
        [
            _otel_span(
                span_id=ROOT_SPAN_ID,
                span_name="workflow",
                attributes={"ag.type.node": "workflow"},
            ),
            _priceable_model_span(parent_id=ROOT_SPAN_ID, start_offset_s=1),
        ]
    )

    root_span = span_idx["workflow"]

    assert _cumulative_costs(root_span)["total"] == pytest.approx(0.00021)
