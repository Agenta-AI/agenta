from datetime import datetime, timedelta, timezone
from typing import Optional

import pytest
from litellm import cost_calculator

from oss.src.apis.fastapi.otlp.utils.processing import parse_from_otel_span_dto
from oss.src.core.otel.dtos import (
    OTelContextDTO,
    OTelSpanDTO,
    OTelSpanKind,
    OTelStatusCode,
)
from oss.src.core.tracing.dtos import OTelFlatSpan, SpanType
from oss.src.core.tracing.utils.trees import (
    KNOWN_PRICING_PROVIDERS,
    TRUSTED_PRICING_PROVIDERS,
    calculate_and_propagate_metrics,
    calculate_costs,
)


OPENAI_MODEL = "gpt-5.3-codex"
ANTHROPIC_MODEL = "claude-sonnet-4-6"

# One real Claude turn: 13,463 of the 13,556 input tokens were served from cache.
# An OpenTelemetry producer reports input_tokens=13,556 (cache included); the agent
# runner reports prompt=93 (cache excluded) plus the cache buckets. Both describe the
# same turn and must price the same.
INCLUSIVE_INPUT = 13_556
CACHE_READ = 13_463
EXCLUSIVE_INPUT = INCLUSIVE_INPUT - CACHE_READ

# Literal prices from the pinned litellm (1.92.0). They are hard-coded on purpose: an
# oracle that recomputes them through the same litellm call pins the wiring but not the
# prices, so it cannot tell a tenfold overcharge from a correct estimate.
CACHED_TURN_PROMPT_COST = {
    OPENAI_MODEL: 0.002518775,
    ANTHROPIC_MODEL: 0.0043179,
}
# What the same turn costs if the cache buckets are added on top of an already-inclusive
# input count, i.e. the double count this pricing path must never produce.
DOUBLE_COUNTED_PROMPT_COST = {
    OPENAI_MODEL: 0.026079025,
    ANTHROPIC_MODEL: 0.0447069,
}


def _span(
    *,
    span_id: str = "s1",
    parent_id: Optional[str] = None,
    span_type: SpanType = SpanType.CHAT,
    response_model: Optional[str] = None,
    request_model: Optional[str] = None,
    parameters_model: Optional[str] = None,
    provider: Optional[str] = None,
    system: Optional[str] = None,
    base_url: Optional[str] = None,
    endpoint: Optional[str] = None,
    input_tokens_includes_cache: Optional[bool] = None,
    prompt: Optional[int] = None,
    completion: Optional[int] = None,
    cache_read: Optional[int] = None,
    cache_creation: Optional[int] = None,
    reported_cost: Optional[float] = None,
) -> OTelFlatSpan:
    meta: dict = {}
    if response_model is not None:
        meta["response"] = {"model": response_model}

    request: dict = {}
    if request_model is not None:
        request["model"] = request_model
    if base_url is not None:
        request["base_url"] = base_url
    if endpoint is not None:
        request["endpoint"] = endpoint
    if request:
        meta["request"] = request

    if provider is not None:
        meta["provider"] = {"name": provider}
    if system is not None:
        meta["system"] = system
    if input_tokens_includes_cache is not None:
        meta["usage"] = {"input_tokens_includes_cache": input_tokens_includes_cache}

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


@pytest.fixture
def litellm_calls(monkeypatch):
    """Capture the exact arguments handed to litellm, and price through the real one."""
    calls: list[dict] = []
    real = cost_calculator.cost_per_token

    def _cost_per_token(**kwargs):
        calls.append(kwargs)
        return real(**kwargs)

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _cost_per_token,
    )

    return calls


# ── the producer contract for cached input ──────────────────────────────────


@pytest.mark.parametrize("model", [OPENAI_MODEL, ANTHROPIC_MODEL])
def test_an_inclusive_producer_is_priced_at_its_input_count(model):
    """OTel says gen_ai.usage.input_tokens already counts cached tokens."""
    span = _span(
        response_model=model,
        input_tokens_includes_cache=True,
        prompt=INCLUSIVE_INPUT,
        completion=0,
        cache_read=CACHE_READ,
    )

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span)["prompt"] == pytest.approx(
        CACHED_TURN_PROMPT_COST[model]
    )


@pytest.mark.parametrize("model", [OPENAI_MODEL, ANTHROPIC_MODEL])
def test_an_unmarked_producer_is_treated_as_inclusive(model):
    """The default must be OTel's meaning: third-party instrumentation sends no marker."""
    span = _span(
        response_model=model,
        prompt=INCLUSIVE_INPUT,
        completion=0,
        cache_read=CACHE_READ,
    )

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span)["prompt"] == pytest.approx(
        CACHED_TURN_PROMPT_COST[model]
    )
    assert _incremental_costs(span)["prompt"] != pytest.approx(
        DOUBLE_COUNTED_PROMPT_COST[model]
    )


@pytest.mark.parametrize("model", [OPENAI_MODEL, ANTHROPIC_MODEL])
def test_an_exclusive_producer_sums_its_cache_buckets_in(model):
    """The runner's shape: prompt is raw uncached input, cache reported separately."""
    span = _span(
        response_model=model,
        input_tokens_includes_cache=False,
        prompt=EXCLUSIVE_INPUT,
        completion=0,
        cache_read=CACHE_READ,
    )

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span)["prompt"] == pytest.approx(
        CACHED_TURN_PROMPT_COST[model]
    )


@pytest.mark.parametrize("model", [OPENAI_MODEL, ANTHROPIC_MODEL])
def test_both_producer_contracts_price_the_same_turn_identically(model):
    inclusive = _span(
        span_id="inclusive",
        response_model=model,
        input_tokens_includes_cache=True,
        prompt=INCLUSIVE_INPUT,
        completion=0,
        cache_read=CACHE_READ,
    )
    exclusive = _span(
        span_id="exclusive",
        response_model=model,
        input_tokens_includes_cache=False,
        prompt=EXCLUSIVE_INPUT,
        completion=0,
        cache_read=CACHE_READ,
    )

    calculate_costs({s.span_id: s for s in (inclusive, exclusive)})

    assert _incremental_costs(inclusive)["total"] == pytest.approx(
        _incremental_costs(exclusive)["total"]
    )


def test_litellm_receives_the_prompt_and_cache_arguments_it_expects(litellm_calls):
    """Pin the tuple: litellm subtracts the cache details from the prompt count."""
    inclusive = _span(
        span_id="inclusive",
        response_model=OPENAI_MODEL,
        input_tokens_includes_cache=True,
        prompt=INCLUSIVE_INPUT,
        completion=7,
        cache_read=CACHE_READ,
        cache_creation=4_096,
    )
    exclusive = _span(
        span_id="exclusive",
        response_model=OPENAI_MODEL,
        input_tokens_includes_cache=False,
        prompt=EXCLUSIVE_INPUT,
        completion=7,
        cache_read=CACHE_READ,
        cache_creation=4_096,
    )

    calculate_costs({"a": inclusive})
    calculate_costs({"b": exclusive})

    assert litellm_calls == [
        {
            "model": OPENAI_MODEL,
            "prompt_tokens": INCLUSIVE_INPUT,
            "completion_tokens": 7,
            "cache_read_input_tokens": CACHE_READ,
            "cache_creation_input_tokens": 4_096,
        },
        {
            "model": OPENAI_MODEL,
            "prompt_tokens": EXCLUSIVE_INPUT + CACHE_READ + 4_096,
            "completion_tokens": 7,
            "cache_read_input_tokens": CACHE_READ,
            "cache_creation_input_tokens": 4_096,
        },
    ]


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
        input_tokens_includes_cache=False,
        prompt=1,
        completion=20,
        cache_read=read or None,
        cache_creation=creation or None,
    )

    calculate_costs({span.span_id: span})

    prompt_cost, completion_cost = cost_calculator.cost_per_token(
        model=model,
        prompt_tokens=1 + read + creation,
        completion_tokens=20,
        cache_read_input_tokens=read,
        cache_creation_input_tokens=creation,
    )
    costs = _incremental_costs(span)

    assert costs["prompt"] == pytest.approx(prompt_cost)
    assert costs["completion"] == pytest.approx(completion_cost)
    assert costs["total"] == pytest.approx(prompt_cost + completion_cost)


@pytest.mark.parametrize("model", [OPENAI_MODEL, ANTHROPIC_MODEL])
def test_cached_input_is_not_dropped_from_the_estimate(model):
    """Regression for #5540: cache-read tokens used to be priced as if absent."""
    span = _span(
        response_model=model,
        input_tokens_includes_cache=False,
        prompt=1,
        completion=20,
        cache_read=25_182,
    )

    calculate_costs({span.span_id: span})

    ignoring_cache, _ = cost_calculator.cost_per_token(
        model=model, prompt_tokens=1, completion_tokens=20
    )

    assert _incremental_costs(span)["prompt"] > 10 * ignoring_cache


@pytest.mark.parametrize("model", [OPENAI_MODEL, ANTHROPIC_MODEL])
def test_ordinary_input_survives_alongside_cache_reads(model):
    """An exclusive prompt bucket is added to, not replaced by, the cache buckets."""
    with_ordinary = _span(
        response_model=model,
        input_tokens_includes_cache=False,
        prompt=EXCLUSIVE_INPUT,
        cache_read=CACHE_READ,
    )
    without_ordinary = _span(
        response_model=model,
        input_tokens_includes_cache=False,
        prompt=0,
        cache_read=CACHE_READ,
    )

    calculate_costs({"a": with_ordinary, "b": without_ordinary})

    assert (
        _incremental_costs(with_ordinary)["prompt"]
        > _incremental_costs(without_ordinary)["prompt"]
    )


# ── model lookup ────────────────────────────────────────────────────────────


def test_request_model_is_used_when_response_model_is_absent():
    span = _span(request_model=OPENAI_MODEL, prompt=1_000, completion=100)

    calculate_costs({span.span_id: span})

    # litellm 1.92.0: 1,000 prompt + 100 completion tokens of gpt-5.3-codex.
    assert _incremental_costs(span)["total"] == pytest.approx(0.00175 + 0.0014)


def test_response_model_wins_over_request_model():
    span = _span(
        response_model=OPENAI_MODEL,
        request_model=ANTHROPIC_MODEL,
        prompt=1_000,
        completion=100,
    )

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span)["total"] == pytest.approx(0.00175 + 0.0014)


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


# ── custom connections must not borrow a public price ───────────────────────


@pytest.mark.parametrize(
    "custom",
    [
        {"system": "acme-gateway"},
        {"provider": "acme-gateway"},
        {"base_url": "https://llm.acme.internal/v1"},
        {"endpoint": "https://llm.acme.internal/v1/chat/completions"},
    ],
    ids=["slug-in-system", "slug-in-provider", "base-url", "endpoint"],
)
def test_a_priceable_request_model_on_a_custom_connection_is_not_priced(custom):
    """A customer deployment named `gpt-5.3-codex` is not OpenAI's `gpt-5.3-codex`.

    The connection slug never reaches `gen_ai.request.model` (the tracer stamps the bare
    model id), so the only evidence of who served the call is the provider identity or a
    custom endpoint. Without a catalog we can attribute the name to, no estimate beats a
    confident wrong one.
    """
    span = _span(request_model=OPENAI_MODEL, prompt=1_000, completion=100, **custom)

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {}


@pytest.mark.parametrize("provider", ["openai", "anthropic", "OpenAI"])
def test_a_request_model_on_a_known_provider_is_still_priced(provider):
    span = _span(
        request_model=OPENAI_MODEL, system=provider, prompt=1_000, completion=100
    )

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span)["total"] == pytest.approx(0.00175 + 0.0014)


@pytest.mark.parametrize(
    "custom",
    [
        {"system": "acme-gateway"},
        {"provider": "acme-gateway"},
        {"base_url": "https://llm.acme.internal/v1"},
        {"endpoint": "https://llm.acme.internal/v1/chat/completions"},
    ],
    ids=["slug-in-system", "slug-in-provider", "base-url", "endpoint"],
)
def test_a_response_model_on_a_custom_connection_is_not_priced_either(custom):
    """The guard covers the model the lookup actually prefers.

    The Pi tracer stamps `gen_ai.response.model` on every assistant message, custom
    connections included, so a guard that only withheld the request model would price a
    customer's own deployment at public rates through the response model instead.
    """
    span = _span(
        response_model=OPENAI_MODEL,
        request_model=OPENAI_MODEL,
        prompt=1_000,
        completion=100,
        **custom,
    )

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {}


def test_a_legacy_parameters_model_on_a_custom_connection_is_not_priced():
    span = _span(
        parameters_model=OPENAI_MODEL,
        system="acme-gateway",
        prompt=1_000,
        completion=100,
    )

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {}


# ── trusted provider identities ─────────────────────────────────────────────


@pytest.mark.parametrize("provider_field", ["system", "provider"])
def test_a_trusted_provider_identity_is_priced(provider_field):
    """`openai-codex` is not a litellm provider; the map says it means OpenAI's catalog.

    Codex needs an explicit pricing identity. The mere presence of a response model is
    not that identity — every Pi assistant message has one, custom connections included.
    """
    span = _span(
        response_model=OPENAI_MODEL,
        request_model=OPENAI_MODEL,
        prompt=1_000,
        completion=100,
        **{provider_field: "openai-codex"},
    )

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span)["total"] == pytest.approx(0.00175 + 0.0014)


def test_a_trusted_provider_behind_a_custom_endpoint_is_not_priced():
    """A gateway charges its own prices, so the endpoint outranks the trusted identity."""
    span = _span(
        response_model=OPENAI_MODEL,
        system="openai-codex",
        base_url="https://llm.acme.internal/v1",
        prompt=1_000,
        completion=100,
    )

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {}


def test_every_trusted_provider_maps_to_a_litellm_provider():
    """The map's values are load-bearing: a typo must withhold prices, not grant them."""
    assert TRUSTED_PRICING_PROVIDERS
    assert all(
        litellm_provider in KNOWN_PRICING_PROVIDERS
        for litellm_provider in TRUSTED_PRICING_PROVIDERS.values()
    )
    assert all(key == key.lower() for key in TRUSTED_PRICING_PROVIDERS)


def test_an_unlisted_agent_provider_is_not_trusted():
    span = _span(
        response_model=OPENAI_MODEL,
        system="openai-codex-lookalike",
        prompt=1_000,
        completion=100,
    )

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {}


# ── a missing measurement is not a measured zero ────────────────────────────


def test_a_model_span_with_no_token_metrics_is_not_priced():
    """No token bucket means nothing was measured; a zero-cost estimate would lie."""
    span = _span(response_model=OPENAI_MODEL)

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {}


@pytest.mark.parametrize(
    "bucket",
    ["prompt", "completion", "cache_read", "cache_creation"],
)
def test_a_single_zero_token_bucket_still_counts_as_measured(bucket):
    """Zero is a fact a producer reported; only an absent bucket is missing."""
    span = _span(response_model=OPENAI_MODEL, **{bucket: 0})

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {
        "prompt": 0.0,
        "completion": 0.0,
        "total": 0.0,
    }


def test_a_token_bucket_holding_only_a_total_is_not_priceable():
    """A total prices nothing on its own, so it must not manufacture a measured zero."""
    span = _span(response_model=OPENAI_MODEL)
    span.attributes["ag"]["metrics"] = {"tokens": {"incremental": {"total": 1_100}}}

    calculate_costs({span.span_id: span})

    assert _incremental_costs(span) == {}


# ── roll-up ─────────────────────────────────────────────────────────────────


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


def test_reported_zero_cost_propagates_to_a_parent_that_reports_nothing():
    """A measured zero is a measurement; the ancestor must show 0, not nothing."""
    parent = _span(span_id="parent", span_type=SpanType.AGENT)
    child = _span(
        span_id="child",
        parent_id="parent",
        span_type=SpanType.AGENT,
        reported_cost=0.0,
    )

    spans = {s.span_id: s for s in calculate_and_propagate_metrics([parent, child])}

    assert _cumulative_costs(spans["parent"]) == {
        "prompt": 0.0,
        "completion": 0.0,
        "total": 0.0,
    }


def test_a_subtree_that_measured_nothing_leaves_the_parent_without_an_attribute():
    """The other half of the rule: never turn a missing measurement into a zero.

    The child is a priced span type carrying a priceable model, so estimation really runs
    on it. A tool child would have been skipped before estimation and left this blind.
    """
    parent = _span(span_id="parent", span_type=SpanType.AGENT)
    child = _span(
        span_id="child",
        parent_id="parent",
        span_type=SpanType.CHAT,
        response_model=OPENAI_MODEL,
    )

    spans = {s.span_id: s for s in calculate_and_propagate_metrics([parent, child])}

    assert _cumulative_costs(spans["child"]) == {}
    assert _cumulative_costs(spans["parent"]) == {}


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


# ── the marker on the wire ──────────────────────────────────────────────────

_TRACE_ID = "a" * 32
_SPAN_ID = "d" * 16
_START = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _ingest_one(attributes: dict) -> OTelFlatSpan:
    otel_span = OTelSpanDTO(
        context=OTelContextDTO(trace_id=f"0x{_TRACE_ID}", span_id=f"0x{_SPAN_ID}"),
        parent=None,
        name="chat",
        kind=OTelSpanKind.SPAN_KIND_INTERNAL,
        start_time=_START,
        end_time=_START + timedelta(seconds=1),
        status_code=OTelStatusCode.STATUS_CODE_OK,
        attributes=attributes,
    )

    (span,) = calculate_and_propagate_metrics([parse_from_otel_span_dto(otel_span)])

    return span


@pytest.mark.parametrize(
    "marker,expected",
    [
        (None, CACHED_TURN_PROMPT_COST[ANTHROPIC_MODEL]),
        (True, CACHED_TURN_PROMPT_COST[ANTHROPIC_MODEL]),
        (False, DOUBLE_COUNTED_PROMPT_COST[ANTHROPIC_MODEL]),
    ],
    ids=["absent-defaults-to-inclusive", "inclusive", "exclusive"],
)
def test_the_wire_marker_selects_the_pricing_contract(marker, expected):
    """Same wire numbers, two producer contracts, two legitimate prices.

    With `input_tokens = 13,556` the inclusive reading is the whole turn and the
    exclusive reading means 13,556 fresh tokens *plus* 13,463 cached ones — a different,
    larger turn. The marker is what tells them apart; absent, OTel's meaning wins.
    """
    attributes = {
        "gen_ai.operation.name": "chat",
        "gen_ai.response.model": ANTHROPIC_MODEL,
        "gen_ai.usage.input_tokens": INCLUSIVE_INPUT,
        "gen_ai.usage.output_tokens": 0,
        "gen_ai.usage.cache_read.input_tokens": CACHE_READ,
    }
    if marker is not None:
        attributes["agenta.usage.input_tokens_includes_cache"] = marker

    span = _ingest_one(attributes)

    assert _incremental_costs(span)["prompt"] == pytest.approx(expected)
