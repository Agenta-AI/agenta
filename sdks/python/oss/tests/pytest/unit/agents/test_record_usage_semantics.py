"""Which usage records reach the workflow span, and how a zero is read.

``record_usage`` stamps the agent run's usage on the ``/invoke`` workflow span. Tokens and cost
are independent measurements there: the runner keeps a billed cost even when it has no
trustworthy token split, and that cost has nowhere else to land — the harness's own spans ship in
a separate OTLP batch, the cumulative roll-up runs per batch, and trace-focused analytics read
root spans only. A record carrying only a cost must therefore still be stamped.

The other half is telling absence from a measurement. A cost is reported whenever its key carries
a number, so ``0.0`` is stamped as the measurement it is; a token total of zero is the runner's
sentinel for "no trustworthy split" and writes no token attributes at all. That reading is sound
only because the producer can express absence: the runner's ``AgentUsage.cost`` is optional and
omitted when the harness reported no cost.

A token count also has to declare its contract. The harness aggregate counts uncached input only,
so the span says so with ``agenta.usage.input_tokens_includes_cache = False`` — without it, ingest
reads the OpenTelemetry (cache-inclusive) meaning and misprices the run.
"""

from __future__ import annotations

from typing import Any, Dict

from opentelemetry.sdk.trace import TracerProvider

from agenta.sdk.agents.tracing import INPUT_TOKENS_INCLUDES_CACHE, record_usage


def _workflow_span():
    return TracerProvider().get_tracer("agenta.tests").start_span("workflow")


def _usage_attributes(span) -> Dict[str, Any]:
    return {
        key: value
        for key, value in dict(span.attributes or {}).items()
        if key.startswith("gen_ai.usage.")
    }


def test_a_cost_without_a_token_split_is_still_stamped():
    # The runner's own shape for "billed, but no trustworthy token count".
    span = _workflow_span()

    record_usage({"input": 0, "output": 0, "total": 0, "cost": 0.04}, span=span)

    assert _usage_attributes(span) == {"gen_ai.usage.cost": 0.04}


def test_a_token_split_without_a_cost_is_still_stamped():
    span = _workflow_span()

    record_usage({"input": 3, "output": 5, "total": 8}, span=span)

    assert _usage_attributes(span) == {
        "gen_ai.usage.input_tokens": 3,
        "gen_ai.usage.output_tokens": 5,
        "gen_ai.usage.prompt_tokens": 3,
        "gen_ai.usage.completion_tokens": 5,
        "gen_ai.usage.total_tokens": 8,
    }


def test_a_record_with_neither_tokens_nor_cost_is_skipped():
    for empty in (None, {}, {"input": 0, "output": 0, "total": 0}):
        span = _workflow_span()

        record_usage(empty, span=span)

        assert _usage_attributes(span) == {}


def test_a_reported_zero_cost_is_a_measurement_but_an_absent_one_is_not():
    reported = _workflow_span()
    absent = _workflow_span()

    record_usage({"input": 3, "output": 5, "total": 8, "cost": 0}, span=reported)
    record_usage({"input": 3, "output": 5, "total": 8}, span=absent)

    # A free model or a fully cached turn really does cost 0.0; a record with no cost key
    # measured nothing, and must not be reported as a zero-cost run.
    assert _usage_attributes(reported)["gen_ai.usage.cost"] == 0.0
    assert "gen_ai.usage.cost" not in _usage_attributes(absent)


def test_a_one_sided_split_keeps_its_measured_zero():
    span = _workflow_span()

    record_usage({"input": 0, "output": 5, "total": 5, "cost": 0.01}, span=span)

    attributes = _usage_attributes(span)
    assert attributes["gen_ai.usage.input_tokens"] == 0
    assert attributes["gen_ai.usage.total_tokens"] == 5


def test_a_run_the_harness_never_priced_stamps_no_cost_at_all():
    # The runner omits `cost` when the harness reported none (codex reports a token split and
    # no cost). Presence-means-measured only holds if such a record stamps nothing: a zero here
    # would tell every downstream aggregate the run was free.
    span = _workflow_span()

    record_usage({"input": 12, "output": 3, "total": 15}, span=span)

    assert "gen_ai.usage.cost" not in _usage_attributes(span)
    assert _usage_attributes(span)["gen_ai.usage.total_tokens"] == 15


def test_a_token_count_declares_that_it_excludes_cached_input():
    # The harness aggregate counts uncached input only (Pi and ACP both report cache reads and
    # writes as siblings of the input count). Ingest assumes the OpenTelemetry cache-INCLUSIVE
    # contract when the marker is absent, so the count has to declare itself.
    span = _workflow_span()

    record_usage({"input": 3, "output": 5, "total": 8, "cost": 0.01}, span=span)

    assert dict(span.attributes or {})[INPUT_TOKENS_INCLUDES_CACHE] is False


def test_a_cost_only_record_declares_nothing_about_token_contracts():
    # No input token count means no contract to declare; a stray marker would describe a count
    # this span never made.
    span = _workflow_span()

    record_usage({"input": 0, "output": 0, "total": 0, "cost": 0.04}, span=span)

    assert INPUT_TOKENS_INCLUDES_CACHE not in dict(span.attributes or {})


def test_a_malformed_record_never_raises_into_the_caller():
    span = _workflow_span()

    record_usage({"total": "not-a-number", "cost": 0.04}, span=span)
    record_usage(["not", "a", "mapping"], span=span)  # type: ignore[arg-type]

    assert _usage_attributes(span) == {}
