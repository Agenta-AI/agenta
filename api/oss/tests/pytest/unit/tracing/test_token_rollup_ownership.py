"""Who owns a token observation, and what the roll-up does when two spans claim the same one.

The agent runner ships one run's spans in a single OTLP request. The `invoke_agent` span used
to repeat the run's totals as `gen_ai.usage.*_tokens` alongside the per-call `chat` spans that
already carried them. Ingest maps those names to the INCREMENTAL bucket, so the roll-up added
the parent's repeat on top of the children it had just summed and every agent run reported
exactly twice its real token count.

These tests drive the real ingest sequence — adapters first, then the tree roll-up — for the
two span trees the runner builds:

    router.otlp_ingest -> parse_from_otel_span_dto (adapters)      [router.py:189]
    router.otlp_ingest -> TracingService.ingest_span_dtos          [router.py:256]
                       -> calculate_and_propagate_metrics_by_trace [service.py:147]

The rule they pin: exactly one span owns each incremental observation, and a parent's total is
either rolled up from its children or carried as an explicitly cumulative summary
(`gen_ai.usage.cost`, which ingest maps to the cumulative bucket).
"""

from collections import OrderedDict
from datetime import datetime, timedelta, timezone

from oss.src.apis.fastapi.otlp.utils.processing import parse_from_otel_span_dto
from oss.src.core.otel.dtos import (
    OTelContextDTO,
    OTelSpanDTO,
    OTelSpanKind,
    OTelStatusCode,
)
from oss.src.core.tracing.utils.trees import (
    calculate_and_propagate_metrics_by_trace,
    find_token_rollup_violations,
    parse_span_dtos_to_span_idx,
    parse_span_idx_to_span_id_tree,
)


TRACE_ID = "a" * 32
WORKFLOW_SPAN_ID = "b" * 16
AGENT_SPAN_ID = "c" * 16

START = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _span_id(index: int) -> str:
    return f"{index:016x}"


def _otel_span(
    *,
    span_id: str,
    span_name: str,
    attributes: dict = None,
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
        attributes=attributes if attributes is not None else {},
    )


def _chat_span(
    *,
    span_id: str,
    parent_id: str,
    prompt: int,
    completion: int,
    start_offset_s: int,
) -> OTelSpanDTO:
    """A leaf model call, stamped the way the runner stamps one."""
    return _otel_span(
        span_id=span_id,
        span_name=f"chat {span_id[-4:]}",
        parent_id=parent_id,
        start_offset_s=start_offset_s,
        attributes={
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-4o-mini",
            "gen_ai.usage.input_tokens": prompt,
            "gen_ai.usage.output_tokens": completion,
            "gen_ai.usage.total_tokens": prompt + completion,
        },
    )


def _ingest(otel_spans) -> dict:
    """Run the ingest sequence (adapters + builder, then the metric roll-up)."""
    span_dtos = [parse_from_otel_span_dto(otel_span) for otel_span in otel_spans]

    return {
        str(span_dto.span_id): span_dto
        for span_dto in calculate_and_propagate_metrics_by_trace(span_dtos)
    }


def _by_id(span_idx: dict, span_id: str):
    # parse_from_otel_span_dto widens the 8-byte OTel span id into a UUID, so index by the
    # trailing hex rather than reconstructing the conversion here.
    matches = [
        span for key, span in span_idx.items() if key.replace("-", "").endswith(span_id)
    ]
    assert len(matches) == 1, (
        f"expected one span ending in {span_id}, got {len(matches)}"
    )
    return matches[0]


def _tokens(span_dto, bucket: str) -> dict:
    return (
        (span_dto.attributes or {})
        .get("ag", {})
        .get("metrics", {})
        .get("tokens", {})
        .get(bucket, {})
    )


def _cumulative_cost(span_dto) -> dict:
    return (
        (span_dto.attributes or {})
        .get("ag", {})
        .get("metrics", {})
        .get("costs", {})
        .get("cumulative", {})
    )


def _violations(otel_spans) -> list:
    """Ingest the batch, then check the invariant against what the roll-up wrote."""
    span_dtos = calculate_and_propagate_metrics_by_trace(
        [parse_from_otel_span_dto(otel_span) for otel_span in otel_spans]
    )
    span_idx = parse_span_dtos_to_span_idx(span_dtos)

    return find_token_rollup_violations(
        parse_span_idx_to_span_id_tree(span_idx),
        span_idx,
    )


# --------------------------------------------------------------------------------------
# The ACP tracer's tree: invoke_agent -> turn 0 -> chat (one model span owns the run total)
# --------------------------------------------------------------------------------------


def test_agent_span_that_owns_only_the_cost_rolls_up_to_the_real_token_total():
    span_idx = _ingest(
        [
            _otel_span(
                span_id=AGENT_SPAN_ID,
                span_name="invoke_agent",
                attributes={
                    "gen_ai.operation.name": "invoke_agent",
                    "gen_ai.usage.cost": 0.0022175,
                },
            ),
            _otel_span(
                span_id=_span_id(1),
                span_name="turn 0",
                parent_id=AGENT_SPAN_ID,
                start_offset_s=1,
            ),
            _chat_span(
                span_id=_span_id(2),
                parent_id=_span_id(1),
                prompt=1500,
                completion=248,
                start_offset_s=2,
            ),
        ]
    )

    agent_span = _by_id(span_idx, AGENT_SPAN_ID)
    turn_span = _by_id(span_idx, _span_id(1))
    chat_span = _by_id(span_idx, _span_id(2))

    # The real total, once. Not 3496.
    assert _tokens(agent_span, "cumulative")["total"] == 1748
    assert _tokens(turn_span, "cumulative")["total"] == 1748
    assert _tokens(chat_span, "incremental")["total"] == 1748
    # The intermediate span owns nothing of its own; it is a pure roll-up.
    assert _tokens(turn_span, "incremental") == {}


def test_agent_span_that_repeats_its_child_total_double_counts_and_is_flagged():
    """The defect, pinned. This is the batch the runner used to send."""
    otel_spans = [
        _otel_span(
            span_id=AGENT_SPAN_ID,
            span_name="invoke_agent",
            attributes={
                "gen_ai.operation.name": "invoke_agent",
                "gen_ai.usage.input_tokens": 1500,
                "gen_ai.usage.output_tokens": 248,
                "gen_ai.usage.total_tokens": 1748,
            },
        ),
        _chat_span(
            span_id=_span_id(2),
            parent_id=AGENT_SPAN_ID,
            prompt=1500,
            completion=248,
            start_offset_s=1,
        ),
    ]
    span_idx = _ingest(otel_spans)

    agent_span = _by_id(span_idx, AGENT_SPAN_ID)

    assert _tokens(agent_span, "cumulative")["total"] == 3496
    assert len(_violations(otel_spans)) == 1


def test_reported_cost_still_reaches_the_agent_span_without_its_tokens():
    span_idx = _ingest(
        [
            _otel_span(
                span_id=AGENT_SPAN_ID,
                span_name="invoke_agent",
                attributes={
                    "gen_ai.operation.name": "invoke_agent",
                    "gen_ai.usage.cost": 0.4237,
                },
            ),
            _chat_span(
                span_id=_span_id(2),
                parent_id=AGENT_SPAN_ID,
                prompt=1000,
                completion=100,
                start_offset_s=1,
            ),
        ]
    )

    agent_span = _by_id(span_idx, AGENT_SPAN_ID)

    assert _cumulative_cost(agent_span)["total"] == 0.4237
    assert _tokens(agent_span, "incremental") == {}
    assert _tokens(agent_span, "cumulative")["total"] == 1100


# --------------------------------------------------------------------------------------
# The Pi tracer's tree: invoke_agent -> turn N -> chat, one turn per assistant message
# --------------------------------------------------------------------------------------


def test_multi_turn_tree_rolls_each_turn_up_exactly_once():
    turn_tokens = [(1600, 250), (1700, 226), (1750, 233), (1800, 217)]
    otel_spans = [
        _otel_span(
            span_id=AGENT_SPAN_ID,
            span_name="invoke_agent",
            attributes={
                "gen_ai.operation.name": "invoke_agent",
                "gen_ai.usage.cost": 0.0040927,
            },
        )
    ]
    for index, (prompt, completion) in enumerate(turn_tokens):
        turn_id = _span_id(10 + index)
        otel_spans.append(
            _otel_span(
                span_id=turn_id,
                span_name=f"turn {index}",
                parent_id=AGENT_SPAN_ID,
                start_offset_s=1 + index * 2,
            )
        )
        otel_spans.append(
            _chat_span(
                span_id=_span_id(20 + index),
                parent_id=turn_id,
                prompt=prompt,
                completion=completion,
                start_offset_s=2 + index * 2,
            )
        )

    span_idx = _ingest(otel_spans)

    expected_total = sum(prompt + completion for prompt, completion in turn_tokens)
    agent_span = _by_id(span_idx, AGENT_SPAN_ID)

    assert _tokens(agent_span, "cumulative")["total"] == expected_total
    for index, (prompt, completion) in enumerate(turn_tokens):
        turn_span = _by_id(span_idx, _span_id(10 + index))
        assert _tokens(turn_span, "cumulative")["total"] == prompt + completion


def test_leaf_only_tree_is_unchanged_by_the_rollup():
    span_idx = _ingest(
        [
            _chat_span(
                span_id=_span_id(2),
                parent_id=None,
                prompt=1000,
                completion=100,
                start_offset_s=0,
            )
        ]
    )

    chat_span = _by_id(span_idx, _span_id(2))

    assert _tokens(chat_span, "incremental")["total"] == 1100
    assert _tokens(chat_span, "cumulative")["total"] == 1100


# --------------------------------------------------------------------------------------
# The invariant itself
# --------------------------------------------------------------------------------------


def test_run_level_usage_with_no_measuring_leaf_is_not_a_violation():
    # The SDK's workflow span carries the run total in its OWN OTLP request, where no model
    # span exists to own it. That is the sanctioned synthetic-run-span case, not a repeat.
    otel_spans = [
        _otel_span(
            span_id=WORKFLOW_SPAN_ID,
            span_name="workflow",
            attributes={
                "ag.type.node": "workflow",
                "gen_ai.usage.input_tokens": 1500,
                "gen_ai.usage.output_tokens": 248,
                "gen_ai.usage.total_tokens": 1748,
            },
        ),
        _otel_span(
            span_id=_span_id(3),
            span_name="execute_tool bash",
            parent_id=WORKFLOW_SPAN_ID,
            start_offset_s=1,
            attributes={"gen_ai.operation.name": "execute_tool"},
        ),
    ]

    span_idx = _ingest(otel_spans)

    assert _violations(otel_spans) == []
    assert _tokens(_by_id(span_idx, WORKFLOW_SPAN_ID), "cumulative")["total"] == 1748


def test_a_non_leaf_that_makes_its_own_model_call_is_not_a_violation():
    """A parent may own usage too: the roll-up starts from its own incremental bucket.

    Against a leaves-only total this warned falsely, because the parent's legitimate
    120 tokens are exactly the excess over its child's 60.
    """
    otel_spans = [
        _chat_span(
            span_id=AGENT_SPAN_ID,
            parent_id=None,
            prompt=100,
            completion=20,
            start_offset_s=0,
        ),
        _chat_span(
            span_id=_span_id(2),
            parent_id=AGENT_SPAN_ID,
            prompt=50,
            completion=10,
            start_offset_s=1,
        ),
    ]

    span_idx = _ingest(otel_spans)

    assert _violations(otel_spans) == []
    assert _tokens(_by_id(span_idx, AGENT_SPAN_ID), "cumulative")["total"] == 180


def test_invariant_holds_for_every_parent_of_a_well_formed_agent_batch():
    otel_spans = [
        _otel_span(
            span_id=AGENT_SPAN_ID,
            span_name="invoke_agent",
            attributes={"gen_ai.operation.name": "invoke_agent"},
        ),
        _otel_span(
            span_id=_span_id(1),
            span_name="turn 0",
            parent_id=AGENT_SPAN_ID,
            start_offset_s=1,
        ),
        _chat_span(
            span_id=_span_id(2),
            parent_id=_span_id(1),
            prompt=10,
            completion=20,
            start_offset_s=2,
        ),
        _chat_span(
            span_id=_span_id(3),
            parent_id=_span_id(1),
            prompt=30,
            completion=40,
            start_offset_s=3,
        ),
    ]

    span_idx = _ingest(otel_spans)

    assert _violations(otel_spans) == []
    assert _tokens(_by_id(span_idx, AGENT_SPAN_ID), "cumulative")["total"] == 100
    assert _tokens(_by_id(span_idx, _span_id(1)), "cumulative")["total"] == 100


def test_calculate_and_propagate_metrics_logs_the_span_that_double_counts(caplog):
    otel_spans = [
        _otel_span(
            span_id=AGENT_SPAN_ID,
            span_name="invoke_agent",
            attributes={
                "gen_ai.operation.name": "invoke_agent",
                "gen_ai.usage.total_tokens": 1748,
                "gen_ai.usage.input_tokens": 1500,
                "gen_ai.usage.output_tokens": 248,
            },
        ),
        _chat_span(
            span_id=_span_id(2),
            parent_id=AGENT_SPAN_ID,
            prompt=1500,
            completion=248,
            start_offset_s=1,
        ),
    ]

    with caplog.at_level("WARNING"):
        _ingest(otel_spans)

    assert any("double counted" in record.getMessage() for record in caplog.records)


def test_find_token_rollup_violations_on_an_empty_forest():
    assert find_token_rollup_violations(OrderedDict(), {}) == []
