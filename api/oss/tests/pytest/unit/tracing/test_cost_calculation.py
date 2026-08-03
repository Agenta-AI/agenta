from typing import Optional

import pytest
from litellm import cost_calculator

from oss.src.core.tracing.dtos import OTelFlatSpan, SpanType
from oss.src.core.tracing.utils.trees import (
    KNOWN_PRICING_PROVIDERS,
    TRUSTED_PRICING_PROVIDERS,
    calculate_and_propagate_metrics,
    calculate_costs,
)


OPENAI_MODEL = "gpt-5.3-codex"
ANTHROPIC_MODEL = "claude-sonnet-4-6"


def _span(
    *,
    span_id: str = "s1",
    parent_id: Optional[str] = None,
    span_type: SpanType = SpanType.CHAT,
    response_model: Optional[str] = None,
    request_model: Optional[str] = None,
    parameters_model: Optional[str] = None,
    prompt: Optional[int] = None,
    completion: Optional[int] = None,
    cache_read: Optional[int] = None,
    cache_creation: Optional[int] = None,
    reported_cost: Optional[float] = None,
) -> OTelFlatSpan:
    meta: dict = {}
    if response_model is not None:
        meta["response"] = {"model": response_model}
    if request_model is not None:
        meta["request"] = {"model": request_model}

    data: dict = {}
    if parameters_model is not None:
        data["parameters"] = {"model": parameters_model}

    tokens: dict = {}
    for key, value in (
        ("prompt", prompt),
        ("completion", completion),
        ("cache_read", cache_read),
        ("cache_creation", cache_creation),
    ):
        if value is not None:
            tokens[key] = value

    metrics: dict = {}
    if tokens:
        metrics["tokens"] = {"incremental": tokens}
    if reported_cost is not None:
        metrics["costs"] = {"cumulative": {"total": reported_cost}}

    ag: dict = {}
    if meta:
        ag["meta"] = meta
    if data:
        ag["data"] = data
    if metrics:
        ag["metrics"] = metrics

    return OTelFlatSpan(
        trace_id="t1",
        span_id=span_id,
        parent_id=parent_id,
        span_type=span_type,
        attributes={"ag": ag},
    )


def _incremental_costs(span: OTelFlatSpan) -> dict:
    return (
        (span.attributes or {})
        .get("ag", {})
        .get("metrics", {})
        .get("costs", {})
        .get("incremental", {})
    )


def _cumulative_costs(span: OTelFlatSpan) -> dict:
    return (
        (span.attributes or {})
        .get("ag", {})
        .get("metrics", {})
        .get("costs", {})
        .get("cumulative", {})
    )


def _expected(model: str, *, prompt: int, completion: int, read: int, creation: int):
    """Oracle: what litellm charges for the inclusive-prompt shape we mean to send."""
    prompt_cost, completion_cost = cost_calculator.cost_per_token(
        model=model,
        prompt_tokens=prompt + read + creation,
        completion_tokens=completion,
        cache_read_input_tokens=read,
        cache_creation_input_tokens=creation,
    )
    return prompt_cost, completion_cost


@pytest.mark.parametrize("model", [OPENAI_MODEL, ANTHROPIC_MODEL])
@pytest.mark.parametrize(
    "read,creation",
    [
        (0, 0),  # no cache
        (25_182, 0),  # cache read only
        (0, 4_096),  # cache creation only
        (25_182, 4_096),  # both cache buckets
    ],
    ids=["no-cache", "cache-read", "cache-creation", "both-buckets"],
)
def test_calculate_costs_prices_cache_buckets(model, read, creation):
    span = _span(
        response_model=model,
        prompt=1,
        completion=20,
        cache_read=read or None,
        cache_creation=creation or None,
    )

    calculate_costs({span.span_id: span})

    prompt_cost, completion_cost = _expected(
        model, prompt=1, completion=20, read=read, creation=creation
    )
    costs = _incremental_costs(span)

    assert costs["prompt"] == pytest.approx(prompt_cost)
    assert costs["completion"] == pytest.approx(completion_cost)
    assert costs["total"] == pytest.approx(prompt_cost + completion_cost)


@pytest.mark.parametrize("model", [OPENAI_MODEL, ANTHROPIC_MODEL])
def test_cached_input_is_not_dropped_from_the_estimate(model):
    """Regression for #5540: cache-read tokens used to be priced as if absent."""
    span = _span(response_model=model, prompt=1, completion=20, cache_read=25_182)

    calculate_costs({span.span_id: span})

    ignoring_cache, _ = cost_calculator.cost_per_token(
        model=model, prompt_tokens=1, completion_tokens=20
    )

    assert _incremental_costs(span)["prompt"] > 10 * ignoring_cache


@pytest.mark.parametrize("model", [OPENAI_MODEL, ANTHROPIC_MODEL])
def test_ordinary_input_survives_alongside_cache_reads(model):
    """The prompt bucket is exclusive, so it must be added to, not replaced by, cache."""
    with_ordinary = _span(response_model=model, prompt=93, cache_read=13_463)
    without_ordinary = _span(response_model=model, prompt=0, cache_read=13_463)

    calculate_costs({"a": with_ordinary, "b": without_ordinary})

    assert (
        _incremental_costs(with_ordinary)["prompt"]
        > _incremental_costs(without_ordinary)["prompt"]
    )


def test_request_model_is_used_when_response_model_is_absent():
    span = _span(request_model=OPENAI_MODEL, prompt=1_000, completion=100)

    calculate_costs({span.span_id: span})

    prompt_cost, completion_cost = _expected(
        OPENAI_MODEL, prompt=1_000, completion=100, read=0, creation=0
    )

    assert _incremental_costs(span)["total"] == pytest.approx(
        prompt_cost + completion_cost
    )


def test_response_model_wins_over_request_model():
    span = _span(
        response_model=OPENAI_MODEL,
        request_model=ANTHROPIC_MODEL,
        prompt=1_000,
        completion=100,
    )

    calculate_costs({span.span_id: span})

    prompt_cost, completion_cost = _expected(
        OPENAI_MODEL, prompt=1_000, completion=100, read=0, creation=0
    )

    assert _incremental_costs(span)["total"] == pytest.approx(
        prompt_cost + completion_cost
    )


def test_legacy_parameters_model_still_works():
    span = _span(parameters_model=OPENAI_MODEL, prompt=1_000, completion=100)

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span)["total"] > 0


@pytest.mark.parametrize("model", ["sonnet", "not-a-real-model", ""])
def test_unpriceable_model_is_contained(model):
    """An alias litellm cannot price must yield no cost, never break the batch."""
    span = _span(request_model=model, prompt=1_000, completion=100, cache_read=500)

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {}


def test_missing_model_is_contained():
    span = _span(prompt=1_000, completion=100)

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {}


def test_non_llm_span_types_are_skipped():
    span = _span(span_type=SpanType.TOOL, response_model=OPENAI_MODEL, prompt=1_000)

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {}


def test_reported_zero_cost_is_not_overwritten_by_an_estimate():
    """Missing and measured-zero are different facts: a free/fully-cached turn is 0."""
    parent = _span(
        span_id="parent",
        span_type=SpanType.AGENT,
        reported_cost=0.0,
    )
    child = _span(
        span_id="child",
        parent_id="parent",
        response_model=OPENAI_MODEL,
        prompt=1_000,
        completion=100,
    )

    spans = {s.span_id: s for s in calculate_and_propagate_metrics([parent, child])}

    assert _cumulative_costs(spans["parent"])["total"] == 0.0
    assert _cumulative_costs(spans["child"])["total"] > 0.0


def test_reported_nonzero_cost_is_not_replaced_by_an_estimate():
    parent = _span(
        span_id="parent",
        span_type=SpanType.AGENT,
        reported_cost=1.25,
    )
    child = _span(
        span_id="child",
        parent_id="parent",
        response_model=OPENAI_MODEL,
        prompt=1_000,
        completion=100,
    )

    spans = {s.span_id: s for s in calculate_and_propagate_metrics([parent, child])}

    assert _cumulative_costs(spans["parent"])["total"] == 1.25


def test_missing_cost_is_filled_by_the_rollup():
    parent = _span(span_id="parent", span_type=SpanType.AGENT)
    child = _span(
        span_id="child",
        parent_id="parent",
        response_model=OPENAI_MODEL,
        prompt=1_000,
        completion=100,
    )

    spans = {s.span_id: s for s in calculate_and_propagate_metrics([parent, child])}

    assert (
        _cumulative_costs(spans["parent"])["total"]
        == _cumulative_costs(spans["child"])["total"]
        > 0.0
    )
