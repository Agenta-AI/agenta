"""OTLP attributes from each instrumentation, through the adapters, to a priced span.

Expected dollar values come from litellm 1.101.0's bundled price map:
claude-sonnet-4-5 input 3e-6, cache read 3e-7, cache write 3.75e-6, output 1.5e-5;
gpt-4o input 2.5e-6, output 1e-5.
"""

from datetime import datetime, timezone

import pytest

from oss.src.apis.fastapi.otlp.extractors.adapter_registry import AdapterRegistry
from oss.src.apis.fastapi.otlp.extractors.canonical_attributes import (
    CanonicalAttributes,
)
from oss.src.core.otel.dtos import OTelSpanKind, OTelStatusCode
from oss.src.core.tracing.dtos import OTelFlatSpan, SpanType
from oss.src.core.tracing.utils.attributes import unmarshall_attributes
from oss.src.core.tracing.utils.trees import calculate_costs


def _ingest(span_attributes: dict) -> OTelFlatSpan:
    bag = CanonicalAttributes(
        span_name="chat",
        trace_id="aaaa" * 8,
        span_id="bbbb" * 4,
        span_kind=OTelSpanKind.SPAN_KIND_CLIENT,
        start_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_time=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
        status_code=OTelStatusCode.STATUS_CODE_OK,
        span_attributes=span_attributes,
    )
    features = AdapterRegistry().extract_features(bag)

    # Mirrors OTelFlatSpanBuilder's key rewrite for metrics.
    flat = {f"ag.meta.{k}": v for k, v in features.meta.items()}
    for key, value in features.metrics.items():
        key = key.replace("unit.tokens.", "tokens.incremental.")
        key = key.replace("unit.costs.", "costs.incremental.")
        flat[f"ag.metrics.{key}"] = value

    span = OTelFlatSpan(
        trace_id="31d6cfe0-4b90-11ec-8001-42010a8000b0",
        span_id="31d6cfe0-4b90-11ec-31d6-cfe04b9011ec",
        span_name="chat",
        span_type=SpanType(features.type["node"]),
        start_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
        attributes=unmarshall_attributes(flat),
    )
    calculate_costs({span.span_id: span})

    return span


def _costs(span: OTelFlatSpan) -> dict:
    return span.attributes["ag"]["metrics"]["costs"]["incremental"]


def test_openinference_nested_cache_counts_are_priced():
    span = _ingest(
        {
            "openinference.span.kind": "LLM",
            "llm.model_name": "claude-sonnet-4-5",
            "llm.token_count.prompt": 1000,
            "llm.token_count.completion": 100,
            "llm.token_count.prompt_details.cache_read": 200,
            "llm.token_count.prompt_details.cache_write": 300,
        }
    )

    assert _costs(span)["prompt"] == pytest.approx(0.002685)
    assert _costs(span)["completion"] == pytest.approx(0.0015)


@pytest.mark.parametrize(
    "marker, prompt_tokens",
    [
        # The Agenta runner: input excludes the cache buckets and says so.
        (False, 500),
        # OpenTelemetry meaning: input includes them.
        (None, 1000),
    ],
)
def test_runner_span_is_priced_by_its_cache_contract(marker, prompt_tokens):
    attributes = {
        "openinference.span.kind": "LLM",
        "gen_ai.operation.name": "chat",
        "gen_ai.system": "anthropic",
        "gen_ai.request.model": "claude-sonnet-4-5",
        "gen_ai.usage.prompt_tokens": prompt_tokens,
        "gen_ai.usage.completion_tokens": 100,
        "gen_ai.usage.cache_read.input_tokens": 200,
        "gen_ai.usage.cache_creation.input_tokens": 300,
    }
    if marker is not None:
        attributes["agenta.usage.input_tokens_includes_cache"] = marker

    span = _ingest(attributes)

    assert _costs(span)["prompt"] == pytest.approx(0.002685)
    assert _costs(span)["completion"] == pytest.approx(0.0015)


@pytest.mark.parametrize("prefix", ["llm.usage", "gen_ai.usage"])
def test_openllmetry_prompt_and_completion_tokens_are_priced(prefix):
    span = _ingest(
        {
            "llm.request.type": "chat",
            "gen_ai.request.model": "gpt-4o",
            f"{prefix}.prompt_tokens": 1000,
            f"{prefix}.completion_tokens": 100,
            "llm.usage.total_tokens": 1100,
        }
    )

    tokens = span.attributes["ag"]["metrics"]["tokens"]["incremental"]
    assert tokens["prompt"] == 1000
    assert tokens["completion"] == 100
    assert _costs(span)["total"] == pytest.approx(0.0035)


def test_openllmetry_span_with_current_genai_usage_keys_is_priced():
    # OpenLLMetry's newer releases emit the current GenAI names. The Logfire adapter maps
    # them for every span, so an OpenLLMetry span needs no second mapping to be priced.
    span = _ingest(
        {
            "llm.request.type": "chat",
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 1000,
            "gen_ai.usage.output_tokens": 100,
            "gen_ai.usage.cache_read.input_tokens": 400,
        }
    )

    tokens = span.attributes["ag"]["metrics"]["tokens"]["incremental"]
    assert tokens["prompt"] == 1000
    assert tokens["completion"] == 100
    assert tokens["cache_read"] == 400
    # 600 fresh input at 2.5e-6, 400 cached at 1.25e-6, 100 output at 1e-5.
    assert _costs(span)["total"] == pytest.approx(0.003)


@pytest.mark.parametrize("marker", [True, "true"])
def test_custom_connection_span_is_not_priced_from_the_public_list(marker):
    span = _ingest(
        {
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 1000,
            "gen_ai.usage.output_tokens": 100,
            "agenta.model.custom_connection": marker,
        }
    )

    metrics = span.attributes["ag"]["metrics"]
    assert "costs" not in metrics
    assert metrics["tokens"]["incremental"]["prompt"] == 1000
    assert span.attributes["ag"]["meta"]["pricing"] == {
        "error": "custom_connection",
        "model": "gpt-4o",
    }


def test_standard_connection_span_is_still_priced():
    span = _ingest(
        {
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 1000,
            "gen_ai.usage.output_tokens": 100,
            "agenta.model.custom_connection": False,
        }
    )

    assert _costs(span)["total"] == pytest.approx(0.0035)


def test_provider_billed_cost_keeps_its_source():
    span = _ingest(
        {
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "anthropic/claude-sonnet-4.5",
            "gen_ai.usage.input_tokens": 1000,
            "gen_ai.usage.output_tokens": 100,
            "gen_ai.usage.cost": 0.0123,
            "agenta.usage.cost_source": "provider",
        }
    )

    assert span.attributes["ag"]["meta"]["usage"]["cost_source"] == "provider"
    # The billed charge is kept as reported, not replaced by a price-list estimate.
    assert _costs(span) == {"total": 0.0123}
